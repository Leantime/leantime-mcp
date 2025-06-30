#!/usr/bin/env node
import { URL } from 'url';
import https from 'https';
import http from 'http';
export class LeantimeMcpProxy {
    config;
    sessionId;
    requestCounter = 0;
    toolCache = new Map();
    cacheTimestamps = new Map();
    CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    constructor(config) {
        this.config = config;
        // Set default retry configuration
        if (!this.config.retry) {
            this.config.retry = {
                maxRetries: 3,
                baseDelay: 1000,
                maxDelay: 30000,
                jitter: true
            };
        }
    }
    async initialize() {
        try {
            this.log('Initializing Leantime MCP Proxy...');
            this.log(`Server: ${this.config.serverUrl}`);
            this.log(`Auth Method: ${this.config.auth.method}`);
            this.log(`SSL verification: ${this.config.skipSsl ? 'disabled' : 'enabled'}`);
            this.log(`Protocol version: ${this.config.protocolVersion || 'latest'}`);
            this.startMessageLoop();
        }
        catch (error) {
            this.logError('Failed to initialize:', error);
            process.exit(1);
        }
    }
    async sendToServerWithRetry(request, attempt = 0) {
        try {
            return await this.sendToServer(request);
        }
        catch (error) {
            if (attempt >= this.config.retry.maxRetries) {
                throw error;
            }
            const delay = this.calculateBackoffDelay(attempt);
            this.log(`Request failed (attempt ${attempt + 1}/${this.config.retry.maxRetries + 1}), retrying in ${delay}ms...`);
            await this.sleep(delay);
            return this.sendToServerWithRetry(request, attempt + 1);
        }
    }
    calculateBackoffDelay(attempt) {
        const { baseDelay, maxDelay, jitter } = this.config.retry;
        let delay = baseDelay * Math.pow(2, attempt);
        delay = Math.min(delay, maxDelay);
        if (jitter) {
            // Add ±25% jitter to prevent thundering herd
            const jitterAmount = delay * 0.25;
            delay += (Math.random() * 2 - 1) * jitterAmount;
        }
        return Math.max(delay, 0);
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    getCacheKey(request) {
        return `${request.method}_${JSON.stringify(request.params || {})}`;
    }
    getCachedResponse(cacheKey) {
        const timestamp = this.cacheTimestamps.get(cacheKey);
        if (!timestamp || Date.now() - timestamp > this.CACHE_TTL) {
            this.toolCache.delete(cacheKey);
            this.cacheTimestamps.delete(cacheKey);
            return null;
        }
        return this.toolCache.get(cacheKey);
    }
    setCachedResponse(cacheKey, response) {
        this.toolCache.set(cacheKey, response);
        this.cacheTimestamps.set(cacheKey, Date.now());
    }
    shouldCache(request) {
        // Don't cache if disabled
        if (this.config.disableCache) {
            return false;
        }
        // Cache list operations and tool schemas
        return ['tools/list', 'resources/list', 'prompts/list'].includes(request.method);
    }
    async sendToServer(request) {
        return new Promise((resolve, reject) => {
            const url = new URL(this.config.serverUrl);
            const isHttps = url.protocol === 'https:';
            const requestModule = isHttps ? https : http;
            const postData = JSON.stringify(request);
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Content-Length': Buffer.byteLength(postData).toString()
            };
            // Add authentication header
            this.addAuthHeader(headers);
            // Add MCP session ID if we have one
            if (this.sessionId) {
                headers['Mcp-Session-Id'] = this.sessionId;
            }
            const options = {
                method: 'POST',
                headers,
                timeout: 300000, // 5 minutes
                ...(this.config.skipSsl && isHttps && { rejectUnauthorized: false })
            };
            const req = requestModule.request(url, options, (res) => {
                const contentType = res.headers['content-type'] || '';
                const isSSE = contentType.includes('text/event-stream');
                // Extract session ID if present
                this.extractSessionId(res.headers);
                if (isSSE) {
                    this.handleSSEResponse(res, resolve, reject);
                }
                else {
                    this.handleJSONResponse(res, resolve, reject);
                }
            });
            req.on('error', (error) => {
                this.logError(`Request error: ${error.message}`);
                reject(error);
            });
            req.on('timeout', () => {
                this.logError('Request timeout');
                req.destroy();
                reject(new Error('Request timeout'));
            });
            req.write(postData);
            req.end();
        });
    }
    addAuthHeader(headers) {
        const { method, token } = this.config.auth;
        switch (method) {
            case 'X-API-Key':
                headers['X-API-Key'] = token;
                break;
            case 'ApiKey':
                headers['Authorization'] = `ApiKey ${token}`;
                break;
            case 'Token':
                headers['Authorization'] = `Token ${token}`;
                break;
            case 'Bearer':
            default:
                headers['Authorization'] = `Bearer ${token}`;
                break;
        }
    }
    extractSessionId(headers) {
        const sessionId = headers['mcp-session-id'] ||
            headers['Mcp-Session-Id'] ||
            headers['MCP-Session-ID'] ||
            headers['mcp_session_id'];
        if (sessionId && typeof sessionId === 'string') {
            if (!this.sessionId) {
                this.sessionId = sessionId;
                this.log(`Session ID captured: ${sessionId}`);
            }
            else if (this.sessionId !== sessionId) {
                this.log(`Session ID changed: ${this.sessionId} -> ${sessionId}`);
                this.sessionId = sessionId;
            }
        }
    }
    handleSSEResponse(res, resolve, reject) {
        let buffer = '';
        res.on('data', (chunk) => {
            buffer += chunk.toString();
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';
            events.forEach(eventData => {
                if (eventData.trim()) {
                    const event = this.parseSSEEvent(eventData);
                    if (event.data) {
                        try {
                            const parsed = JSON.parse(event.data);
                            resolve(parsed);
                        }
                        catch (error) {
                            this.logError(`Invalid JSON in SSE: ${error}`);
                        }
                    }
                }
            });
        });
        res.on('end', () => {
            if (buffer.trim()) {
                const event = this.parseSSEEvent(buffer);
                if (event.data) {
                    try {
                        const parsed = JSON.parse(event.data);
                        resolve(parsed);
                    }
                    catch (error) {
                        reject(new Error(`Invalid JSON in final SSE: ${error}`));
                    }
                }
            }
        });
        res.on('error', (error) => {
            reject(error);
        });
    }
    handleJSONResponse(res, resolve, reject) {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                // Check if this is a valid JSON-RPC response
                if (this.isValidJsonRpcResponse(parsed)) {
                    resolve(parsed);
                }
                else {
                    // Convert invalid response to proper JSON-RPC error
                    const convertedResponse = this.convertServerErrorToJsonRpc(data, parsed);
                    resolve(convertedResponse);
                }
            }
            catch (error) {
                // Handle completely invalid JSON (like HTML error pages)
                const errorResponse = this.convertServerErrorToJsonRpc(data, null);
                resolve(errorResponse);
            }
        });
        res.on('error', (error) => {
            reject(error);
        });
    }
    isValidJsonRpcResponse(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }
        // Check for required JSON-RPC fields
        if (data.jsonrpc !== "2.0") {
            return false;
        }
        // Must have either result or error, and should have an id (except for notifications)
        if (data.result === undefined && data.error === undefined) {
            return false;
        }
        // Check for PHP error fields that shouldn't be in JSON-RPC
        const phpErrorFields = ['message', 'exception', 'file', 'line', 'trace'];
        const hasPhpErrorFields = phpErrorFields.some(field => data[field] !== undefined && typeof data[field] === 'string' && !data.result && !data.error);
        return !hasPhpErrorFields;
    }
    convertServerErrorToJsonRpc(responseData, parsed) {
        try {
            // Try to extract request ID from any previous context
            let requestId = null;
            if (parsed && (parsed.id !== undefined)) {
                requestId = parsed.id;
            }
            // Handle different types of server errors
            if (parsed && typeof parsed === 'object') {
                // PHP error with exception details
                if (parsed.message || parsed.exception) {
                    return {
                        jsonrpc: "2.0",
                        id: requestId,
                        error: {
                            code: -32603, // Internal error
                            message: parsed.message || "Server internal error",
                            data: {
                                type: "server_error",
                                details: parsed.exception || parsed.message || "Unknown server error"
                            }
                        }
                    };
                }
                // Array of validation errors (like Zod validation)
                if (Array.isArray(parsed)) {
                    return {
                        jsonrpc: "2.0",
                        id: requestId,
                        error: {
                            code: -32600, // Invalid Request
                            message: "Server validation error",
                            data: {
                                type: "validation_error",
                                details: parsed
                            }
                        }
                    };
                }
            }
            // Generic server error response
            return {
                jsonrpc: "2.0",
                id: requestId,
                error: {
                    code: -32603,
                    message: "Invalid server response",
                    data: {
                        type: "malformed_response",
                        original: responseData.substring(0, 200)
                    }
                }
            };
        }
        catch (e) {
            // Final fallback for completely broken responses
            return {
                jsonrpc: "2.0",
                id: null,
                error: {
                    code: -32700, // Parse error
                    message: "Invalid JSON response from server",
                    data: {
                        type: "parse_error",
                        original: responseData.substring(0, 200)
                    }
                }
            };
        }
    }
    parseSSEEvent(data) {
        const lines = data.split('\n');
        let eventData = '';
        let eventType = '';
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                eventData += line.substring(6);
            }
            else if (line.startsWith('event: ')) {
                eventType = line.substring(7);
            }
        }
        return { type: eventType, data: eventData };
    }
    async startMessageLoop() {
        this.log('Ready to handle MCP requests...');
        // Handle incoming messages from stdin and forward to server
        process.stdin.setEncoding('utf8');
        let buffer = '';
        process.stdin.on('readable', () => {
            let chunk;
            while (null !== (chunk = process.stdin.read())) {
                buffer += chunk;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.trim()) {
                        this.handleIncomingMessage(line.trim()).catch(error => {
                            this.logError('Error handling message:', error);
                        });
                    }
                }
            }
        });
        process.stdin.on('end', () => {
            this.log('Input stream ended - client disconnected');
            this.cleanup();
        });
    }
    async handleIncomingMessage(message) {
        let parsed = null;
        let requestId = null;
        try {
            parsed = JSON.parse(message);
            requestId = parsed.id !== undefined ? parsed.id : null;
            this.requestCounter++;
            this.log(`[${this.requestCounter}] Handling request: ${parsed.method || 'unknown'} (id: ${requestId})`);
            // Handle MCP notifications specially
            if (parsed.method && parsed.method.startsWith('notifications/')) {
                this.log(`[${this.requestCounter}] Notification: ${parsed.method}`);
                if (parsed.method === 'notifications/initialized') {
                    this.log(`[${this.requestCounter}] MCP handshake completed - ready for requests`);
                }
                // Notifications don't expect responses to the client
                return;
            }
            let response;
            // Special handling for initialize method - send session init after responding
            if (parsed.method === 'initialize') {
                response = await this.sendToServerWithRetry(parsed);
                if (requestId !== null) {
                    response = { ...response, id: requestId };
                }
                // Send response to client first
                process.stdout.write(JSON.stringify(response) + '\n');
                this.log(`[${this.requestCounter}] Request completed successfully`);
                // Now send notifications/initialized to mark session as ready
                try {
                    this.log(`[${this.requestCounter}] Sending notifications/initialized to server...`);
                    const initNotification = {
                        jsonrpc: '2.0',
                        method: 'notifications/initialized',
                        params: {}
                        // No ID for notifications
                    };
                    await this.sendToServerWithRetry(initNotification);
                    this.log(`[${this.requestCounter}] Server session initialized successfully`);
                }
                catch (error) {
                    this.logError(`[${this.requestCounter}] Failed to initialize server session:`, error);
                }
                return;
            }
            // Check cache for cacheable requests
            if (this.shouldCache(parsed)) {
                const cacheKey = this.getCacheKey(parsed);
                const cachedResponse = this.getCachedResponse(cacheKey);
                if (cachedResponse) {
                    this.log(`[${this.requestCounter}] Cache hit for ${parsed.method}`);
                    // Ensure cached response has correct ID from original request
                    response = { ...cachedResponse };
                    if (requestId !== null) {
                        response.id = requestId;
                    }
                }
                else {
                    this.log(`[${this.requestCounter}] Cache miss for ${parsed.method}, fetching...`);
                    response = await this.sendToServerWithRetry(parsed);
                    // Cache response but ensure current request gets correct ID
                    this.setCachedResponse(cacheKey, response);
                    if (requestId !== null) {
                        response = { ...response, id: requestId };
                    }
                }
            }
            else {
                // Use retry logic for non-cacheable requests (like tool calls)
                response = await this.sendToServerWithRetry(parsed);
                // Ensure response has correct ID from original request
                if (requestId !== null) {
                    response = { ...response, id: requestId };
                }
            }
            // Send response back to client
            process.stdout.write(JSON.stringify(response) + '\n');
            this.log(`[${this.requestCounter}] Request completed successfully`);
        }
        catch (error) {
            this.logError(`[${this.requestCounter}] Failed to handle message:`, error);
            // Send error response with correct ID
            const errorResponse = {
                jsonrpc: '2.0',
                id: requestId,
                error: {
                    code: -32603,
                    message: 'Internal error',
                    data: error instanceof Error ? error.message : String(error)
                }
            };
            process.stdout.write(JSON.stringify(errorResponse) + '\n');
        }
    }
    cleanup() {
        this.log('Cleaning up proxy...');
        process.exit(0);
    }
    log(message) {
        console.error(`[LeantimeMCP] ${message}`);
    }
    logError(message, error) {
        console.error(`[LeantimeMCP ERROR] ${message}`, error || '');
    }
}
// Command line interface
function parseArgs() {
    const args = process.argv.slice(2);
    let serverUrl = '';
    let token = '';
    let authMethod = 'Bearer';
    let skipSsl = false;
    let protocolVersion = undefined;
    let maxRetries = 3;
    let baseDelay = 1000;
    let disableCache = false;
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--token':
                if (i + 1 < args.length) {
                    const nextArg = args[++i];
                    if (nextArg) {
                        token = nextArg;
                    }
                }
                break;
            case '--auth-method':
                if (i + 1 < args.length) {
                    const nextArg = args[++i];
                    if (nextArg) {
                        authMethod = nextArg || 'Bearer';
                    }
                }
                break;
            case '--insecure':
            case '--skip-ssl':
                skipSsl = true;
                break;
            case '--protocol-version':
                if (i + 1 < args.length) {
                    const nextArg = args[++i];
                    if (nextArg) {
                        protocolVersion = nextArg;
                    }
                }
                break;
            case '--max-retries':
                if (i + 1 < args.length) {
                    const nextArg = args[++i];
                    if (nextArg) {
                        maxRetries = parseInt(nextArg, 10) || 3;
                    }
                }
                break;
            case '--retry-delay':
                if (i + 1 < args.length) {
                    const nextArg = args[++i];
                    if (nextArg) {
                        baseDelay = parseInt(nextArg, 10) || 1000;
                    }
                }
                break;
            case '--no-cache':
                disableCache = true;
                break;
            default:
                if (!serverUrl) {
                    const currentArg = args[i];
                    if (currentArg) {
                        serverUrl = currentArg;
                    }
                }
                break;
        }
    }
    if (!serverUrl || !token) {
        console.error('Usage: leantime-mcp <url> --token <token> [options]');
        console.error('');
        console.error('Options:');
        console.error('  --auth-method <method>    Authentication method (Bearer, ApiKey, Token, X-API-Key)');
        console.error('  --insecure               Skip SSL verification');
        console.error('  --protocol-version <ver> MCP protocol version');
        console.error('  --max-retries <num>      Maximum retry attempts (default: 3)');
        console.error('  --retry-delay <ms>       Base retry delay in milliseconds (default: 1000)');
        console.error('  --no-cache               Disable response caching');
        console.error('');
        console.error('Examples:');
        console.error('  leantime-mcp https://leantime.example.com/mcp --token abc123');
        console.error('  leantime-mcp https://leantime.example.com/mcp --token abc123 --auth-method ApiKey');
        console.error('  leantime-mcp https://leantime.example.com/mcp --token abc123 --max-retries 5 --no-cache');
        process.exit(1);
    }
    const config = {
        serverUrl,
        auth: { method: authMethod, token },
        skipSsl,
        retry: {
            maxRetries,
            baseDelay,
            maxDelay: 30000,
            jitter: true
        }
    };
    if (protocolVersion) {
        config.protocolVersion = protocolVersion;
    }
    // Disable caching if requested
    if (disableCache) {
        config.disableCache = true;
    }
    return config;
}
// Handle graceful shutdown
function setupSignalHandlers() {
    const cleanup = () => {
        console.error('\nReceived shutdown signal, cleaning up...');
        process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}
// Main execution
async function main() {
    try {
        const config = parseArgs();
        const proxy = new LeantimeMcpProxy(config);
        setupSignalHandlers();
        await proxy.initialize();
    }
    catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}
// Run if this is the main module (always run for bin scripts)
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map
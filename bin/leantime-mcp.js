#!/usr/bin/env node

const https = require('https');
const http = require('http');
const process = require('process');
const { URL } = require('url');

// Parse command line arguments
const args = process.argv.slice(2);
let serverUrl, bearerToken, skipSsl = false, authMethod = 'Bearer';

// Parse arguments
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && i + 1 < args.length) {
        bearerToken = args[i + 1];
        i++;
    } else if (args[i] === '--auth-method' && i + 1 < args.length) {
        authMethod = args[i + 1];
        i++;
    } else if (args[i] === '--insecure' || args[i] === '--skip-ssl') {
        skipSsl = true;
    } else if (!serverUrl) {
        serverUrl = args[i];
    }
}

// Validate required arguments
if (!serverUrl || !bearerToken) {
    console.error('Usage: leantime-mcp <url> --token <token> [--auth-method <method>] [--insecure]');
    console.error('');
    console.error('Auth Methods:');
    console.error('  Bearer (default) - Authorization: Bearer <token>');
    console.error('  ApiKey           - Authorization: ApiKey <token>');
    console.error('  Token            - Authorization: Token <token>');
    console.error('  X-API-Key        - X-API-Key: <token>');
    console.error('');
    console.error('Examples:');
    console.error('  leantime-mcp https://leantime.example.com/mcp --token abc123');
    console.error('  leantime-mcp https://leantime.example.com/mcp --token abc123 --auth-method ApiKey');
    console.error('  leantime-mcp https://localhost/mcp --token abc123 --insecure --auth-method X-API-Key');
    process.exit(1);
}

// Configure SSL if needed
if (skipSsl) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Determine if we need HTTP or HTTPS
const url = new URL(serverUrl);
const isHttps = url.protocol === 'https:';
const requestModule = isHttps ? https : http;

let buffer = '';
let activeRequests = new Map(); // Track multiple concurrent requests
let connectionCount = 0;
let isShuttingDown = false;
let mcpSessionId = null; // Store session ID from server

process.stdin.setEncoding('utf8');
process.stdin.on('readable', () => {
    let chunk;
    while (null !== (chunk = process.stdin.read())) {
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop();

        lines.forEach(line => {
            if (line.trim()) {
                sendToServer(line.trim());
            }
        });
    }
});

function parseSSEEvent(data) {
    const lines = data.split('\n');
    let eventData = '';
    let eventType = '';

    for (const line of lines) {
        if (line.startsWith('data: ')) {
            eventData += line.substring(6);
        } else if (line.startsWith('event: ')) {
            eventType = line.substring(7);
        }
    }

    return { type: eventType, data: eventData };
}

function sendToServer(jsonRpcMessage) {
    if (isShuttingDown) {
        console.error('Bridge is shutting down, ignoring request');
        return;
    }

    connectionCount++;
    const requestId = connectionCount;
    console.error(`[Request #${requestId}] Starting...`);

    const postData = jsonRpcMessage;

    // Parse the message to check if it's a tool call for logging
    let messageType = 'unknown';
    try {
        const parsed = JSON.parse(jsonRpcMessage);
        messageType = parsed.method || 'unknown';
        console.error(`[Request #${requestId}] Method: ${messageType}`);
        if (parsed.method === 'tools/call') {
            console.error(`[Request #${requestId}] Tool call: ${parsed.params?.name || 'unknown'}`);
        }

        // Warn about large requests (tool parameters can be big)
        if (postData.length > 1048576) { // 1MB
            console.error(`[Request #${requestId}] Large request: ${Math.round(postData.length / 1024)}KB`);
        }
    } catch (e) {
        console.error(`[Request #${requestId}] Invalid JSON in outgoing message`);
    }

    // Build headers with appropriate auth method
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(postData)
        // Removed Cache-Control and Connection headers for testing
    };

    // Add authentication header based on method
    if (authMethod === 'X-API-Key') {
        headers['X-API-Key'] = bearerToken;
        console.error(`[Request #${requestId}] Auth: X-API-Key: ${bearerToken.substring(0, 8)}...`);
    } else if (authMethod === 'ApiKey') {
        headers['Authorization'] = `ApiKey ${bearerToken}`;
        console.error(`[Request #${requestId}] Auth: Authorization: ApiKey ${bearerToken.substring(0, 8)}...`);
    } else if (authMethod === 'Token') {
        headers['Authorization'] = `Token ${bearerToken}`;
        console.error(`[Request #${requestId}] Auth: Authorization: Token ${bearerToken.substring(0, 8)}...`);
    } else {
        // Default to Bearer
        headers['Authorization'] = `Bearer ${bearerToken}`;
        console.error(`[Request #${requestId}] Auth: Authorization: Bearer ${bearerToken.substring(0, 8)}...`);
    }

    console.error(`[Request #${requestId}] Full headers:`, JSON.stringify(headers, null, 2));
    console.error(`[Request #${requestId}] Request body: ${postData.substring(0, 200)}...`);

    const options = {
        method: 'POST',
        headers: headers,
        // Increase timeout for tool execution
        timeout: 300000 // 5 minutes for long-running tools
    };

    if (skipSsl && isHttps) {
        options.rejectUnauthorized = false;
    }

    // Don't close previous requests - handle them concurrently
    // Each request gets its own entry in the activeRequests map

    const currentRequest = requestModule.request(serverUrl, options, (res) => {
        const contentType = res.headers['content-type'] || '';
        const isSSE = contentType.includes('text/event-stream');

        // Extract MCP session ID from response headers (if present)
        const sessionId = res.headers['mcp-session-id'];
        if (sessionId && !mcpSessionId) {
            mcpSessionId = sessionId;
            console.error(`[Request #${requestId}] Captured MCP Session ID: ${sessionId.substring(0, 8)}...`);
        }

        console.error(`[Request #${requestId}] Response Status: ${res.statusCode}`);
        console.error(`[Request #${requestId}] Response Headers:`, JSON.stringify(res.headers, null, 2));
        console.error(`[Request #${requestId}] Response Content-Type: ${contentType}`);
        console.error(`[Request #${requestId}] Using SSE mode: ${isSSE}`);

        if (isSSE) {
            // Handle Server-Sent Events - important for streaming tool results
            let sseBuffer = '';

            res.on('data', (chunk) => {
                sseBuffer += chunk.toString();

                // Process complete SSE events (double newline separated)
                const events = sseBuffer.split('\n\n');
                sseBuffer = events.pop(); // Keep incomplete event in buffer

                events.forEach(eventData => {
                    if (eventData.trim()) {
                        const event = parseSSEEvent(eventData);

                        // Handle different event types
                        if (event.type === 'message' || !event.type) {
                            // Standard message event - could be tool results
                            if (event.data) {
                                try {
                                    const parsed = JSON.parse(event.data);
                                    // Log tool results for debugging
                                    if (parsed.result && parsed.result.content) {
                                        console.error(`[Request #${requestId}] Tool result received (${parsed.result.content.length} chars)`);
                                    }
                                    process.stdout.write(event.data + '\n');
                                } catch (e) {
                                    console.error(`[Request #${requestId}] Invalid JSON in SSE data: ${e.message}`);
                                    console.error(`Data: ${event.data}`);
                                }
                            }
                        } else if (event.type === 'error') {
                            console.error(`[Request #${requestId}] SSE Error: ${event.data}`);
                        } else if (event.type === 'close') {
                            console.error(`[Request #${requestId}] SSE connection closed by server`);
                            res.destroy();
                        } else if (event.type === 'progress') {
                            // Handle progress events for long-running tools
                            console.error(`[Request #${requestId}] Tool progress: ${event.data}`);
                            if (event.data) {
                                try {
                                    JSON.parse(event.data);
                                    process.stdout.write(event.data + '\n');
                                } catch (e) {
                                    console.error(`[Request #${requestId}] Invalid JSON in progress event: ${e.message}`);
                                }
                            }
                        } else {
                            // Forward other event types as-is (tool-specific events)
                            if (event.data) {
                                try {
                                    JSON.parse(event.data);
                                    process.stdout.write(event.data + '\n');
                                } catch (e) {
                                    console.error(`[Request #${requestId}] Non-JSON SSE event (${event.type}): ${event.data}`);
                                }
                            }
                        }
                    }
                });
            });

            res.on('end', () => {
                // Process any remaining data in buffer
                if (sseBuffer.trim()) {
                    const event = parseSSEEvent(sseBuffer);
                    if (event.data) {
                        try {
                            JSON.parse(event.data);
                            process.stdout.write(event.data + '\n');
                        } catch (e) {
                            console.error(`[Request #${requestId}] Invalid JSON in final SSE data: ${e.message}`);
                        }
                    }
                }
                console.error(`[Request #${requestId}] SSE stream ended`);
                activeRequests.delete(requestId);
            });

        } else {
            // Handle regular JSON response - could be tool results
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;

                // Warn about large responses (tool results can be big)
                if (responseData.length > 1048576) { // 1MB
                    console.error(`[Request #${requestId}] Large response received: ${Math.round(responseData.length / 1024)}KB`);
                }
            });

            res.on('end', () => {
                if (responseData.trim()) {
                    try {
                        const parsed = JSON.parse(responseData);
                        // Log tool results for debugging
                        if (parsed.result && parsed.result.content) {
                            console.error(`[Request #${requestId}] Tool result received: ${parsed.result.content.length} chars`);
                        } else if (parsed.error) {
                            console.error(`[Request #${requestId}] Tool error: ${parsed.error.message || 'Unknown error'}`);
                        }

                        // Ensure we send clean JSON
                        const cleanJson = JSON.stringify(parsed);
                        process.stdout.write(cleanJson + '\n');
                        console.error(`[Request #${requestId}] Completed successfully`);
                    } catch (e) {
                        console.error(`[Request #${requestId}] Invalid JSON response: ${e.message}`);
                        console.error(`Response: ${responseData.substring(0, 500)}...`);
                        // Try to send the raw response anyway in case it's partially valid
                        process.stdout.write(responseData + '\n');
                    }
                }
                activeRequests.delete(requestId);
            });
        }

        res.on('error', (e) => {
            console.error(`[Request #${requestId}] Response error: ${e.message}`);
            activeRequests.delete(requestId);
        });
    });

    // Store the request in our tracking map
    activeRequests.set(requestId, currentRequest);

    currentRequest.on('error', (e) => {
        console.error(`[Request #${requestId}] Request error: ${e.message}`);
        activeRequests.delete(requestId);
    });

    currentRequest.on('timeout', () => {
        console.error(`[Request #${requestId}] Request timeout (5 minutes)`);
        if (activeRequests.has(requestId)) {
            activeRequests.get(requestId).destroy();
            activeRequests.delete(requestId);
        }
    });

    currentRequest.write(postData);
    currentRequest.end();
}

// Handle graceful shutdown
function cleanup() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.error(`Shutting down bridge after handling ${connectionCount} requests...`);
    if (activeRequests.size > 0) {
        console.error(`Closing ${activeRequests.size} active requests...`);
        for (const [requestId, request] of activeRequests) {
            console.error(`Closing request #${requestId}`);
            request.destroy();
        }
        activeRequests.clear();
    }
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Handle stdin end
process.stdin.on('end', () => {
    console.error('Input stream ended - client disconnected');
    cleanup();
});

// Log startup info to stderr (won't interfere with MCP communication)
console.error(`=== Leantime MCP Bridge Starting ===`);
console.error(`Mode: Long-running persistent connection`);
console.error(`Server: ${serverUrl}`);
console.error(`Auth Method: ${authMethod}`);
console.error(`SSL verification: ${skipSsl ? 'disabled' : 'enabled'}`);
console.error(`Supports: HTTP JSON responses and Server-Sent Events (SSE)`);
console.error(`Features: Session management, concurrent requests, large payloads`);
console.error(`Tool call features: Large payload support, streaming results, 5min timeout`);
console.error(`Ready to handle MCP requests...`);
#!/usr/bin/env node

const https = require('https');
const http = require('http');
const process = require('process');
const { URL } = require('url');

// Parse command line arguments
const args = process.argv.slice(2);
let serverUrl, bearerToken, skipSsl = false;

// Parse arguments
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && i + 1 < args.length) {
        bearerToken = args[i + 1];
        i++;
    } else if (args[i] === '--insecure' || args[i] === '--skip-ssl') {
        skipSsl = true;
    } else if (!serverUrl) {
        serverUrl = args[i];
    }
}

// Validate required arguments
if (!serverUrl || !bearerToken) {
    console.error('Usage: leantime-mcp-bridge <url> --token <token> [--insecure]');
    console.error('');
    console.error('Examples:');
    console.error('  leantime-mcp https://leantime.example.com/mcp --token abc123');
    console.error('  leantime-mcp https://localhost/mcp --token abc123 --insecure');
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
let activeRequest = null;

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
    const postData = jsonRpcMessage;

    // Parse the message to check if it's a tool call for logging
    let messageType = 'unknown';
    try {
        const parsed = JSON.parse(jsonRpcMessage);
        messageType = parsed.method || 'unknown';
        if (parsed.method === 'tools/call') {
            console.error(`Tool call: ${parsed.params?.name || 'unknown'}`);
        }

        // Warn about large requests (tool parameters can be big)
        if (postData.length > 1048576) { // 1MB
            console.error(`Large request: ${Math.round(postData.length / 1024)}KB`);
        }
    } catch (e) {
        console.error('Invalid JSON in outgoing message');
    }

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'Authorization': `Bearer ${bearerToken}`,
            'Content-Length': Buffer.byteLength(postData),
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        },
        // Increase timeout for tool execution
        timeout: 300000 // 5 minutes for long-running tools
    };

    if (skipSsl && isHttps) {
        options.rejectUnauthorized = false;
    }

    // Close any existing request first
    if (activeRequest) {
        activeRequest.destroy();
        activeRequest = null;
    }

    activeRequest = requestModule.request(serverUrl, options, (res) => {
        const contentType = res.headers['content-type'] || '';
        const isSSE = contentType.includes('text/event-stream');

        console.error(`Response Content-Type: ${contentType}`);
        console.error(`Using SSE mode: ${isSSE}`);

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
                                        console.error(`Tool result received (${parsed.result.content.length} chars)`);
                                    }
                                    process.stdout.write(event.data + '\n');
                                } catch (e) {
                                    console.error(`Invalid JSON in SSE data: ${e.message}`);
                                    console.error(`Data: ${event.data}`);
                                }
                            }
                        } else if (event.type === 'error') {
                            console.error(`SSE Error: ${event.data}`);
                        } else if (event.type === 'close') {
                            console.error('SSE connection closed by server');
                            res.destroy();
                        } else if (event.type === 'progress') {
                            // Handle progress events for long-running tools
                            console.error(`Tool progress: ${event.data}`);
                            if (event.data) {
                                try {
                                    JSON.parse(event.data);
                                    process.stdout.write(event.data + '\n');
                                } catch (e) {
                                    console.error(`Invalid JSON in progress event: ${e.message}`);
                                }
                            }
                        } else {
                            // Forward other event types as-is (tool-specific events)
                            if (event.data) {
                                try {
                                    JSON.parse(event.data);
                                    process.stdout.write(event.data + '\n');
                                } catch (e) {
                                    console.error(`Non-JSON SSE event (${event.type}): ${event.data}`);
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
                            console.error(`Invalid JSON in final SSE data: ${e.message}`);
                        }
                    }
                }
                console.error('SSE stream ended');
                activeRequest = null;
            });

        } else {
            // Handle regular JSON response - could be tool results
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;

                // Warn about large responses (tool results can be big)
                if (responseData.length > 1048576) { // 1MB
                    console.error(`Large response received: ${Math.round(responseData.length / 1024)}KB`);
                }
            });

            res.on('end', () => {
                if (responseData.trim()) {
                    try {
                        const parsed = JSON.parse(responseData);
                        // Log tool results for debugging
                        if (parsed.result && parsed.result.content) {
                            console.error(`Tool result received: ${parsed.result.content.length} chars`);
                        } else if (parsed.error) {
                            console.error(`Tool error: ${parsed.error.message || 'Unknown error'}`);
                        }
                        process.stdout.write(responseData + '\n');
                    } catch (e) {
                        console.error(`Invalid JSON response: ${e.message}`);
                        console.error(`Response: ${responseData.substring(0, 500)}...`);
                    }
                }
                activeRequest = null;
            });
        }

        res.on('error', (e) => {
            console.error(`Response error: ${e.message}`);
            activeRequest = null;
        });
    });

    activeRequest.on('error', (e) => {
        console.error(`Request error: ${e.message}`);
        activeRequest = null;
    });

    activeRequest.on('timeout', () => {
        console.error('Request timeout');
        if (activeRequest) {
            activeRequest.destroy();
            activeRequest = null;
        }
    });

    activeRequest.write(postData);
    activeRequest.end();
}

// Handle graceful shutdown
function cleanup() {
    console.error('Shutting down...');
    if (activeRequest) {
        activeRequest.destroy();
        activeRequest = null;
    }
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Handle stdin end
process.stdin.on('end', () => {
    console.error('Input stream ended');
    cleanup();
});

// Log startup info to stderr (won't interfere with MCP communication)
console.error(`Leantime MCP Bridge starting...`);
console.error(`Server: ${serverUrl}`);
console.error(`SSL verification: ${skipSsl ? 'disabled' : 'enabled'}`);
console.error(`Supports: HTTP JSON responses and Server-Sent Events (SSE)`);
console.error(`Tool call features: Large payload support, streaming results, 5min timeout`);
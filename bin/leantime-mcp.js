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

function sendToServer(jsonRpcMessage) {
    const postData = jsonRpcMessage;

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${bearerToken}`,
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    if (skipSsl && isHttps) {
        options.rejectUnauthorized = false;
    }

    const req = requestModule.request(serverUrl, options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
            responseData += chunk;
        });

        res.on('end', () => {
            process.stdout.write(responseData + '\n');
        });
    });

    req.on('error', (e) => {
        console.error(`Request error: ${e.message}`);
    });

    req.write(postData);
    req.end();
}

process.on('SIGINT', () => {
    process.exit(0);
});

// Log startup info to stderr (won't interfere with MCP communication)
console.error(`Leantime MCP Bridge starting...`);
console.error(`Server: ${serverUrl}`);
console.error(`SSL verification: ${skipSsl ? 'disabled' : 'enabled'}`);
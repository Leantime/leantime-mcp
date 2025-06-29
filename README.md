# Leantime MCP Bridge v2.0

A robust Model Context Protocol (MCP) proxy bridge for Leantime project management system. Built with TypeScript and the official MCP SDK, this tool provides a reliable bridge between MCP clients and Leantime servers.

## ✨ Features

- **Built with Official MCP SDK**: Uses `@modelcontextprotocol/sdk` for robust protocol handling
- **Multiple Authentication Methods**: Bearer, API Key, Token, and X-API-Key headers
- **Protocol Version Support**: MCP 2025-03-26 (latest) with backward compatibility
- **Advanced Transport Support**: HTTP/HTTPS, Server-Sent Events (SSE), and streaming responses
- **TypeScript Implementation**: Type-safe, maintainable codebase
- **Drop-in Replacement**: Same CLI interface as v1.x for easy migration

## 🚀 Installation

### From npm (once published)
```bash
npm install -g leantime-mcp
```

### From source
```bash
git clone https://github.com/leantime/leantime-mcp.git
cd leantime-mcp
npm install
npm run build
npm install -g .
```

## 📖 Usage

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "leantime": {
      "command": "leantime-mcp",
      "args": [
        "https://your-leantime.com/mcp",
        "--token",
        "YOUR_TOKEN_HERE"
      ],
      "env": {
        "LEANTIME_TOKEN": "YOUR_TOKEN_HERE"
      }
    }
  }
}
```

#### For Local Development with Self-Signed Certificates

```json
{
  "mcpServers": {
    "leantime": {
      "command": "leantime-mcp",
      "args": [
        "https://leantime-oss.test/mcp",
        "--token",
        "YOUR_TOKEN_HERE",
        "--insecure"
      ]
    }
  }
}
```

#### Using Absolute Path (if global install doesn't work)

```json
{
  "mcpServers": {
    "leantime": {
      "command": "node",
      "args": [
        "/path/to/leantime-mcp/dist/index.js",
        "https://your-leantime.com/mcp",
        "--token",
        "YOUR_TOKEN_HERE"
      ]
    }
  }
}
```

### Command Line Usage

```bash
leantime-mcp <url> --token <token> [options]
```

### Parameters

- `<url>` - The Leantime MCP endpoint URL (required)
- `--token <token>` - Authentication token (required)
- `--auth-method <method>` - Authentication method (optional, default: Bearer)
- `--insecure` - Skip SSL certificate verification (optional)
- `--protocol-version <version>` - MCP protocol version (optional)
- `--max-retries <num>` - Maximum retry attempts (optional, default: 3)
- `--retry-delay <ms>` - Base retry delay in milliseconds (optional, default: 1000)
- `--no-cache` - Disable response caching (optional)

### Authentication Methods

| Method | Header Format | Example |
|--------|---------------|---------|
| `Bearer` (default) | `Authorization: Bearer <token>` | `--auth-method Bearer` |
| `ApiKey` | `Authorization: ApiKey <token>` | `--auth-method ApiKey` |
| `Token` | `Authorization: Token <token>` | `--auth-method Token` |
| `X-API-Key` | `X-API-Key: <token>` | `--auth-method X-API-Key` |

### Examples

#### Basic usage with Bearer token
```bash
leantime-mcp https://leantime.example.com/mcp --token abc123
```

#### Using API Key authentication
```bash
leantime-mcp https://leantime.example.com/mcp --token abc123 --auth-method ApiKey
```

#### Local development with self-signed certificates
```bash
leantime-mcp https://localhost/mcp --token abc123 --insecure
```

#### Specific protocol version
```bash
leantime-mcp https://leantime.example.com/mcp --token abc123 --protocol-version 2025-03-26
```

#### High-reliability setup with custom retry settings
```bash
leantime-mcp https://leantime.example.com/mcp --token abc123 --max-retries 5 --retry-delay 2000
```

#### Disable caching for development/testing
```bash
leantime-mcp https://leantime.example.com/mcp --token abc123 --no-cache
```

## 🔧 How It Works

1. **Protocol Handling**: Uses official MCP SDK for robust JSON-RPC message handling
2. **Authentication**: Adds appropriate authentication headers based on chosen method
3. **Transport Layer**: Supports both regular HTTP responses and Server-Sent Events (SSE)
4. **Error Handling**: Comprehensive error handling with proper JSON-RPC error responses
5. **Session Management**: Tracks MCP session IDs for stateful interactions
6. **Retry Logic**: Exponential backoff with jitter prevents thundering herd problems
7. **Smart Caching**: Caches tool/resource/prompt lists to reduce server load

## 🔄 Advanced Features

### Retry Logic with Exponential Backoff
- **Automatic retries**: Failed requests are automatically retried (default: 3 attempts)
- **Exponential backoff**: Delay doubles with each retry (1s → 2s → 4s...)
- **Jitter**: Random ±25% variation prevents thundering herd effect
- **Configurable**: Customize max retries and base delay via CLI options

### Smart Response Caching
- **Automatic caching**: `tools/list`, `resources/list`, and `prompts/list` responses are cached
- **TTL-based expiry**: Cached responses expire after 5 minutes
- **Memory efficient**: Automatic cleanup of expired cache entries
- **Configurable**: Use `--no-cache` to disable for development/testing

### Production-Ready Reliability
- **Connection resilience**: Handles network interruptions gracefully
- **Request tracking**: Numbered requests for easy debugging
- **Comprehensive logging**: Detailed logs to stderr (won't interfere with MCP communication)
- **Graceful shutdown**: Clean termination on SIGINT/SIGTERM

## 🏗️ Architecture

### v2.0 Improvements over v1.x

- **TypeScript Rewrite**: Type-safe implementation with better maintainability
- **Official SDK Integration**: Uses `@modelcontextprotocol/sdk` instead of custom implementation
- **Enhanced Authentication**: Support for multiple authentication methods
- **Better Error Handling**: Proper JSON-RPC error responses and logging
- **Protocol Negotiation**: Automatic protocol version negotiation
- **Streaming Support**: Full support for SSE and streaming responses

### Protocol Support

- **Primary**: MCP 2025-03-26 (latest specification)
- **Fallback**: MCP 2024-11-05 (backward compatibility)
- **Auto-negotiation**: Automatically detects and uses appropriate protocol version

## 🧪 Development

### Prerequisites
- Node.js 18.0.0 or higher
- TypeScript 5.4.0 or higher
- Access to a Leantime instance with MCP support

### Building from Source
```bash
# Clone the repository
git clone https://github.com/leantime/leantime-mcp.git
cd leantime-mcp

# Install dependencies
npm install

# Build TypeScript
npm run build

# Test locally
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | node dist/index.js https://your-leantime.com/mcp --token your-token
```

### Development Mode
```bash
# Watch for changes and rebuild
npm run dev
```

## 🛡️ Security Considerations

- **HTTPS Only**: Always use HTTPS in production environments
- **Token Security**: Store tokens securely and avoid logging them
- **SSL Verification**: Only use `--insecure` flag in development
- **Token Rotation**: Consider implementing token rotation for long-running processes
- **Network Security**: Ensure proper network security between proxy and Leantime server

## 🐛 Error Handling

The proxy includes comprehensive error handling for:

- **Network Issues**: Connection timeouts, DNS resolution failures
- **Authentication**: Invalid tokens, expired credentials
- **Protocol Errors**: Malformed JSON-RPC messages, protocol mismatches
- **Server Errors**: HTTP errors, invalid responses from Leantime
- **Transport Issues**: SSE connection problems, streaming errors

All error messages are logged to `stderr` to avoid interfering with MCP communication on `stdout`.

## 🛠️ Troubleshooting

### Common Issues and Solutions

#### "Mcp-Session-Id header required for POST requests"
**Fixed in v2.0**: The proxy now automatically captures and includes the MCP session ID in all requests after the initial handshake.

#### "Invalid JSON-RPC response" errors in Claude Desktop
**Fixed in v2.0**: The proxy now converts PHP error responses from Leantime into proper JSON-RPC error format that Claude Desktop can understand.

#### Connection keeps dropping/restarting
- **Check your token**: Ensure the Leantime API token is valid and has proper permissions
- **Network issues**: Use `--max-retries 5` for unreliable connections
- **SSL problems**: Use `--insecure` for development with self-signed certificates

#### Proxy exits immediately without error
This is normal behavior - the proxy waits for JSON-RPC messages from Claude Desktop via stdin. If you're testing manually, send a JSON-RPC message:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | leantime-mcp https://your-leantime.com/mcp --token YOUR_TOKEN
```

#### "Command not found: leantime-mcp"
- **Global install**: Run `npm install -g .` from the project directory
- **Use absolute path**: Reference the compiled script directly in your Claude Desktop config:
  ```json
  "command": "node",
  "args": ["/absolute/path/to/leantime-mcp/dist/index.js", ...]
  ```

### Debug Mode

Enable verbose logging to troubleshoot connection issues:

```bash
# The proxy logs to stderr, so you can see debug info while MCP communication continues
leantime-mcp https://your-leantime.com/mcp --token YOUR_TOKEN 2>debug.log
```

### Checking Logs

**Claude Desktop logs**: Check `~/Library/Logs/Claude/mcp-server-leantime.log` (macOS) for detailed MCP communication logs.

**Proxy logs**: All proxy logs go to `stderr` and include:
- Request/response tracking with numbered IDs
- Cache hit/miss information  
- Retry attempts and backoff timing
- Session ID management
- Error details and conversions

## 📊 Logging

The proxy provides detailed logging for debugging:

```
[LeantimeMCP] Initializing Leantime MCP Proxy...
[LeantimeMCP] Server: https://leantime.example.com/mcp
[LeantimeMCP] Auth Method: Bearer
[LeantimeMCP] SSL verification: enabled
[LeantimeMCP] Protocol version: 2025-03-26
[LeantimeMCP] Ready to handle MCP requests...
```

## 📄 License

MIT License - see LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with TypeScript
4. Add tests if applicable
5. Build and test (`npm run build && npm test`)
6. Submit a pull request

## 💬 Support

For issues and questions:
- Create an issue on [GitHub Issues](https://github.com/leantime/leantime-mcp/issues)
- Check [Leantime documentation](https://leantime.io/docs/) for MCP setup
- Verify your token has proper permissions in Leantime

## 📋 Changelog

### 2.0.0 (Latest)
- 🎉 **Complete TypeScript rewrite** using official MCP SDK
- ✨ **Multiple authentication methods** (Bearer, ApiKey, Token, X-API-Key)
- 🚀 **Enhanced protocol support** (MCP 2025-03-26 + backward compatibility)
- 🔧 **Improved error handling** and logging
- 📡 **Better transport layer** with SSE and streaming support
- 🛡️ **Enhanced security** and session management
- 📦 **Smaller codebase** (80% reduction) with better maintainability
- 🔄 **Advanced retry logic** with exponential backoff and jitter
- 💾 **Smart caching** for tool lists and schemas (5-minute TTL)
- ⚡ **Production-ready** connection resilience and error recovery

### 1.x.x (Legacy)
- Basic MCP proxy functionality
- HTTP/HTTPS support
- Bearer token authentication only
- SSL verification bypass option
# Leantime MCP Bridge

A Model Context Protocol (MCP) proxy bridge for Leantime project management system. This tool acts as a bridge between MCP clients and Leantime servers, forwarding JSON-RPC messages with proper authentication.


## Installation

### From npm (once published)
```bash
npm install -g leantime-mcp
```


## Use in clients

### Claude Desktop

```
{
  "mcpServers": {
    "leantime": {
      "command": "node",
      "args": [
        "leantime-mcp",
        "https://your-leantime.com/mcp",
        "--token", "YOUR_TOKEN_HERE"
      ]
    }
  }
}

```


### From source
```bash
git clone https://github.com/yourusername/leantime-mcp-bridge.git
cd leantime-mcp-bridge
npm install -g .
```

## Usage

### Command Line
```bash
leantime-mcp-bridge <url> --token <token> [--insecure]
```

### Parameters

- `<url>` - The Leantime MCP endpoint URL (required)
- `--token <token>` - Bearer authentication token (required)
- `--insecure` or `--skip-ssl` - Skip SSL certificate verification (optional)

### Examples

#### Basic usage with HTTPS
```bash
leantime-mcp-bridge https://leantime.example.com/mcp --token abc123
```

#### Local development with self-signed certificates
```bash
leantime-mcp-bridge https://localhost/mcp --token abc123 --insecure
```

#### Using with HTTP (not recommended for production)
```bash
leantime-mcp-bridge http://localhost:8080/mcp --token abc123
```

## How it works

1. The bridge reads JSON-RPC messages from `stdin`
2. Each message is forwarded to the specified Leantime MCP endpoint via HTTP/HTTPS
3. Responses are written to `stdout`
4. The bridge handles authentication using Bearer tokens
5. Supports both HTTP and HTTPS protocols
6. Optional SSL verification bypass for development environments

## MCP Integration

This bridge is designed to work with MCP (Model Context Protocol) clients. The bridge:

- Maintains the JSON-RPC message format
- Adds proper HTTP headers for Leantime compatibility
- Handles authentication transparently
- Preserves message ordering and integrity

## Development

### Prerequisites
- Node.js 14.0.0 or higher
- Access to a Leantime instance with MCP support

### Local Development
```bash
# Clone the repository
git clone https://github.com/yourusername/leantime-mcp-bridge.git
cd leantime-mcp-bridge

# Make the script executable (Unix/Linux/macOS)
chmod +x bin/leantime-mcp.js

# Test locally
echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | node bin/leantime-mcp.js https://your-leantime.com/mcp --token your-token
```

## Error Handling

The bridge includes error handling for:
- Network connectivity issues
- SSL certificate problems
- Authentication failures
- Malformed JSON-RPC messages

Error messages are logged to `stderr` to avoid interfering with MCP communication on `stdout`.

## Security Considerations

- Always use HTTPS in production environments
- Store tokens securely and avoid logging them
- The `--insecure` flag should only be used in development
- Consider implementing token rotation for long-running processes

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions:
- Create an issue on GitHub
- Check Leantime documentation for MCP setup
- Verify your token has proper permissions

## Changelog

### 1.0.0
- Initial release
- Basic MCP proxy functionality
- HTTP/HTTPS support
- Bearer token authentication
- SSL verification bypass option
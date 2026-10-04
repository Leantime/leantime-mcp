# Leantime MCP Bridge — DEPRECATED

> **This package is no longer needed and is no longer maintained.**
> Leantime's MCP server speaks Streamable HTTP, and every current MCP client can connect to it directly. Remove `leantime-mcp` from your client config and use one of the setups below — your existing token keeps working.

**Full guide:** [docs.leantime.io → Leantime's MCP Server](https://docs.leantime.io/#/installation/leantime-mcp)

## Prerequisites

- Leantime Cloud, or self-hosted Leantime 3.10.3+ with the [MCP Server plugin](https://marketplace.leantime.io/product/mcp-server/)
- A Personal Access Token (**My Profile → Personal Access Tokens**) sent as `Authorization: Bearer …`, or an API key (`lt_…`) sent as `x-api-key`

## Migrating

**Claude Code**

```bash
claude mcp add --transport http leantime https://yourworkspace.leantime.io/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

**Cursor** (`~/.cursor/mcp.json`) — VS Code and Windsurf are equivalent, see the guide:

```json
{
  "mcpServers": {
    "leantime": {
      "url": "https://yourworkspace.leantime.io/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
    }
  }
}
```

**Claude Desktop** — replace the `leantime-mcp` command with the generic [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "leantime": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://yourworkspace.leantime.io/mcp", "--header", "Authorization:${LEANTIME_AUTH}"],
      "env": { "LEANTIME_AUTH": "Bearer YOUR_TOKEN" }
    }
  }
}
```

Then uninstall the bridge: `npm uninstall -g leantime-mcp`.

## License

MIT

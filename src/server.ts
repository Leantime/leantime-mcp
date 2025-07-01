#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { LeantimeMcpProxy } from './proxy.js';
import { parseArgs } from './config.js';

async function createServer(): Promise<Server> {
  const config = parseArgs();
  const proxy = new LeantimeMcpProxy(config);

  const server = new Server(
    {
      name: 'leantime-mcp',
      version: '1.6.2',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Flag to track if we've initialized the Leantime session
  let leantimeSessionInitialized = false;

  // Helper function to ensure Leantime session is initialized
  async function ensureLeantimeSession() {
    if (!leantimeSessionInitialized) {
      try {
        // Send initialize request to Leantime server
        const initRequest = {
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            clientInfo: {
              name: 'leantime-mcp',
              version: '1.6.2'
            }
          }
        };

        const initResponse = await proxy.proxyRequest(initRequest);
        
        if (initResponse.error) {
          console.error('Failed to initialize Leantime session:', initResponse.error);
          return;
        }

        // Send initialized notification
        const initializedNotification = {
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {}
        };

        await proxy.proxyRequest(initializedNotification);
        leantimeSessionInitialized = true;
        console.error('Leantime session initialized successfully');
      } catch (error) {
        console.error('Error initializing Leantime session:', error);
      }
    }
  }

  // Handle tool listing - proxy to Leantime server
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      // Ensure Leantime session is initialized first
      await ensureLeantimeSession();

      const request = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/list',
        params: {}
      };

      const response = await proxy.proxyRequest(request);
      
      if (response.error) {
        throw new McpError(ErrorCode.InternalError, `Failed to list tools: ${response.error.message}`);
      }

      // Return the tools from the proxied response, or fallback to empty array
      return {
        tools: response.result?.tools || []
      };
    } catch (error) {
      console.error('Error listing tools:', error);
      // Return empty tools array if we can't connect to server
      return {
        tools: []
      };
    }
  });

  // Handle tool calls - proxy to Leantime server  
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      // Ensure Leantime session is initialized first
      await ensureLeantimeSession();

      const proxyRequest = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: request.params.name,
          arguments: request.params.arguments || {}
        }
      };

      const response = await proxy.proxyRequest(proxyRequest);
      
      if (response.error) {
        throw new McpError(ErrorCode.InternalError, `Tool call failed: ${response.error.message}`);
      }

      return {
        content: response.result?.content || [
          {
            type: 'text',
            text: JSON.stringify(response.result, null, 2)
          }
        ]
      };
    } catch (error) {
      console.error('Error calling tool:', error);
      throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return server;
}

async function main() {
  try {
    const server = await createServer();
    
    // Create stdio transport
    const transport = new StdioServerTransport();
    
    // Connect server to transport
    await server.connect(transport);
    
    console.error('Leantime MCP Server running on stdio');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('\nReceived SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\nReceived SIGTERM, shutting down...');
  process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
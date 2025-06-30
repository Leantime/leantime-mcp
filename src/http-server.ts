#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import { LeantimeMcpProxy, ProxyConfig, AuthConfig } from './index.js';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'leantime-mcp' });
});

// Main MCP endpoint
app.post('/mcp', async (req, res) => {
  try {
    // Extract configuration from query parameters (Smithery standard)
    const config = extractConfig(req.query);
    
    // Validate required configuration
    if (!config.serverUrl || !config.auth.token) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: req.body.id || null,
        error: {
          code: -32602,
          message: 'Invalid params: LEANTIME_SERVER_URL and LEANTIME_API_TOKEN are required'
        }
      });
    }

    // Create proxy instance
    const proxy = new LeantimeMcpProxy(config);
    
    // Handle the MCP request
    const response = await proxy.handleHttpRequest(req.body);
    
    return res.json(response);
  } catch (error) {
    console.error('HTTP MCP request failed:', error);
    return res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : String(error)
      }
    });
  }
});

function extractConfig(queryParams: any): ProxyConfig {
  const serverUrl = queryParams.LEANTIME_SERVER_URL || process.env.LEANTIME_SERVER_URL || '';
  const token = queryParams.LEANTIME_API_TOKEN || process.env.LEANTIME_API_TOKEN || '';
  const authMethod = (queryParams.AUTH_METHOD || process.env.AUTH_METHOD || 'Bearer') as AuthConfig['method'];
  const skipSsl = queryParams.SKIP_SSL === 'true' || process.env.SKIP_SSL === 'true';
  const maxRetries = parseInt(queryParams.MAX_RETRIES || process.env.MAX_RETRIES || '3', 10);
  const baseDelay = parseInt(queryParams.RETRY_DELAY || process.env.RETRY_DELAY || '1000', 10);
  const disableCache = queryParams.DISABLE_CACHE === 'true' || process.env.DISABLE_CACHE === 'true';

  return {
    serverUrl,
    auth: { method: authMethod, token },
    skipSsl,
    retry: {
      maxRetries,
      baseDelay,
      maxDelay: 30000,
      jitter: true
    },
    disableCache
  };
}

app.listen(port, () => {
  console.log(`Leantime MCP HTTP server listening on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`MCP endpoint: http://localhost:${port}/mcp`);
});
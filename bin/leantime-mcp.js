#!/usr/bin/env node

// Simple wrapper that runs the MCP server
import('../dist/index.js').then(module => {
  // The server.js file handles everything - no need to duplicate logic
}).catch(error => {
  console.error('Failed to start Leantime MCP server:', error);
  process.exit(1);
});
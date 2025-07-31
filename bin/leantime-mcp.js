#!/usr/bin/env node

// Simple wrapper that runs the MCP server
import('../dist/index.js').then(async (module) => {
  // Call the main function if it exists
  if (typeof module.main === 'function') {
    await module.main();
  }
}).catch(error => {
  console.error('Failed to start Leantime MCP server:', error);
  process.exit(1);
});
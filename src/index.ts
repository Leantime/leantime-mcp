#!/usr/bin/env node

import { LeantimeMcpProxy } from './proxy.js';
import { parseArgs } from './config.js';

// Handle graceful shutdown
function setupSignalHandlers(): void {
  const cleanup = () => {
    console.error('\nReceived shutdown signal, cleaning up...');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// Main execution
async function main(): Promise<void> {
  try {
    const config = parseArgs();
    const proxy = new LeantimeMcpProxy(config);
    
    setupSignalHandlers();
    await proxy.initialize();
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
#!/usr/bin/env node

import { ProxyConfig, AuthConfig } from './proxy.js';

export function parseArgs(): ProxyConfig {
  const args = process.argv.slice(2);
  let serverUrl = '';
  let token = '';
  let authMethod: AuthConfig['method'] = 'Bearer';
  let skipSsl = false;
  let protocolVersion: string | undefined = undefined;
  let maxRetries = 3;
  let baseDelay = 1000;
  let disableCache = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token':
        if (i + 1 < args.length) {
          const nextArg = args[++i];
          if (nextArg) {
            token = nextArg;
          }
        }
        break;
      case '--auth-method':
        if (i + 1 < args.length) {
          const nextArg = args[++i];
          if (nextArg) {
            authMethod = (nextArg as AuthConfig['method']) || 'Bearer';
          }
        }
        break;
      case '--insecure':
      case '--skip-ssl':
        skipSsl = true;
        break;
      case '--protocol-version':
        if (i + 1 < args.length) {
          const nextArg = args[++i];
          if (nextArg) {
            protocolVersion = nextArg;
          }
        }
        break;
      case '--max-retries':
        if (i + 1 < args.length) {
          const nextArg = args[++i];
          if (nextArg) {
            maxRetries = parseInt(nextArg, 10) || 3;
          }
        }
        break;
      case '--retry-delay':
        if (i + 1 < args.length) {
          const nextArg = args[++i];
          if (nextArg) {
            baseDelay = parseInt(nextArg, 10) || 1000;
          }
        }
        break;
      case '--no-cache':
        disableCache = true;
        break;
      default:
        if (!serverUrl) {
          const currentArg = args[i];
          if (currentArg) {
            serverUrl = currentArg;
          }
        }
        break;
    }
  }

  // Check for environment variable fallbacks
  if (!serverUrl) {
    serverUrl = process.env.LEANTIME_SERVER_URL || '';
  }
  if (!token) {
    token = process.env.LEANTIME_API_TOKEN || '';
  }

  if (!serverUrl || !token) {
    console.error('Usage: leantime-mcp <url> --token <token> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --auth-method <method>    Authentication method (Bearer, ApiKey, Token, X-API-Key)');
    console.error('  --insecure               Skip SSL verification');
    console.error('  --protocol-version <ver> MCP protocol version');
    console.error('  --max-retries <num>      Maximum retry attempts (default: 3)');
    console.error('  --retry-delay <ms>       Base retry delay in milliseconds (default: 1000)');
    console.error('  --no-cache               Disable response caching');
    console.error('');
    console.error('Environment Variables:');
    console.error('  LEANTIME_SERVER_URL      Leantime server URL (alternative to <url> argument)');
    console.error('  LEANTIME_API_TOKEN       API token for authentication (alternative to --token)');
    console.error('');
    console.error('Examples:');
    console.error('  leantime-mcp https://leantime.example.com/mcp --token abc123');
    console.error('  leantime-mcp https://leantime.example.com/mcp --token abc123 --auth-method ApiKey');
    console.error('  LEANTIME_SERVER_URL=https://leantime.example.com/mcp LEANTIME_API_TOKEN=abc123 leantime-mcp');
    console.error('  leantime-mcp https://leantime.example.com/mcp --token abc123 --max-retries 5 --no-cache');
    process.exit(1);
  }

  const config: ProxyConfig = {
    serverUrl,
    auth: { method: authMethod, token },
    skipSsl,
    retry: {
      maxRetries,
      baseDelay,
      maxDelay: 30000,
      jitter: true
    }
  };

  if (protocolVersion) {
    config.protocolVersion = protocolVersion;
  }

  if (disableCache) {
    config.disableCache = true;
  }

  return config;
}
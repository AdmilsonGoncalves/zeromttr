import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'authorization',
      'headers.authorization',
      'MCP_AUTH_TOKEN',
      'GITHUB_TOKEN',
      'RESEND_API_KEY',
      'GRAFANA_API_TOKEN',
      '*.token',
      '*.apiKey',
      '*.secret'
    ],
    censor: '[REDACTED]'
  }
});

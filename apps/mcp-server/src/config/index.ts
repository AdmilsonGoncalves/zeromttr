const authToken = process.env.MCP_AUTH_TOKEN || '';

if (process.env.NODE_ENV === 'production' && !authToken) {
  throw new Error('MCP_AUTH_TOKEN must be defined and non-empty in production');
}

export const mcpConfig = {
  port: Number(process.env.MCP_PORT) || 8000,
  authToken
};

export const mcpConfig = {
  port: Number(process.env.MCP_PORT) || 8000,
  authToken: process.env.MCP_AUTH_TOKEN || ''
};

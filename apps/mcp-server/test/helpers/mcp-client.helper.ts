/* eslint-disable @typescript-eslint/no-explicit-any */
import type http from 'node:http';
import { makeRequest } from './http.js';
import { mcpConfig } from '../../src/config/index.js';

export interface McpCallResult {
  status: number;
  body: any;
  result?: {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  };
  parsedContent?: any;
}

export async function listMcpTools(
  server: http.Server,
  token: string = mcpConfig.MCP_AUTH_TOKEN
): Promise<{
  status: number;
  body: any;
  tools?: any[];
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await makeRequest(server, '/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    })
  });

  return {
    status: res.status,
    body: res.body,
    tools: (res.body as any)?.result?.tools
  };
}

export async function callMcpTool(
  server: http.Server,
  toolName: string,
  args: Record<string, unknown>,
  token: string = mcpConfig.MCP_AUTH_TOKEN
): Promise<McpCallResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await makeRequest(server, '/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    })
  });

  let parsedContent: any = undefined;
  const result = (res.body as any)?.result;
  if (result?.content?.[0]?.text) {
    try {
      parsedContent = JSON.parse(result.content[0].text);
    } catch {
      parsedContent = result.content[0].text;
    }
  }

  return {
    status: res.status,
    body: res.body,
    result,
    parsedContent
  };
}

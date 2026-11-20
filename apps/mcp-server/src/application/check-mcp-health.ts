import { getMcpDomainStatus } from '../domain/mcp-domain-status.js';

/**
 * Checks MCP server application readiness based on domain status.
 */
export function checkMcpApplicationHealth(): { healthy: boolean; status: string } {
  const domainStatus = getMcpDomainStatus();
  return {
    healthy: domainStatus.status === 'ready',
    status: domainStatus.status
  };
}

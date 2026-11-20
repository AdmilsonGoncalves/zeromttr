import { getMcpDomainStatus } from '../domain/mcp-domain-status.js';

export function checkMcpApplicationHealth(): { healthy: boolean; status: string } {
  const domainStatus = getMcpDomainStatus();
  return {
    healthy: domainStatus.status === 'ready',
    status: domainStatus.status
  };
}

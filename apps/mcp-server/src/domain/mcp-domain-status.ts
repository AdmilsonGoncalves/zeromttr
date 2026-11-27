// Semantic version of the MCP domain readiness contract
export const DOMAIN_VERSION = '1.0.0';

export enum McpDomainReadinessStatus {
  READY = 'ready'
}

/**
 * Returns the MCP server domain readiness status and version.
 */
export function getMcpDomainStatus(): { status: McpDomainReadinessStatus; version: string } {
  return {
    status: McpDomainReadinessStatus.READY,
    version: DOMAIN_VERSION
  };
}

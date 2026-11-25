// Semantic version of the MCP domain readiness contract
export const DOMAIN_VERSION = '1.0.0';

/**
 * Returns the MCP server domain readiness status and version.
 */
export function getMcpDomainStatus(): { status: string; version: string } {
  return {
    status: 'ready',
    version: DOMAIN_VERSION
  };
}

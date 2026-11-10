export * from './finops.js';
export * from './summarize-series.js';
export * from './truncate.js';
export * from './span-analysis.js';

export const DOMAIN_VERSION = '1.0.0';

export function getMcpDomainStatus(): { status: string; version: string } {
  return {
    status: 'ready',
    version: DOMAIN_VERSION
  };
}

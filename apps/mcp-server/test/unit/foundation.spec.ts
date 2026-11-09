import { describe, it, expect } from 'vitest';
import { getMcpDomainStatus } from '../../src/domain/index.js';
import { checkMcpApplicationHealth } from '../../src/application/index.js';

describe('mcp-server foundation', () => {
  it('should return ready status from domain layer', () => {
    const status = getMcpDomainStatus();
    expect(status.status).toBe('ready');
    expect(status.version).toBe('1.0.0');
  });

  it('should check application health based on domain', () => {
    const health = checkMcpApplicationHealth();
    expect(health.healthy).toBe(true);
    expect(health.status).toBe('ready');
  });
});

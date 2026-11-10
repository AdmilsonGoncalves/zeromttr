import { describe, it, expect } from 'vitest';
import { initTelemetry } from '../../src/telemetry/index.js';

describe('target-app-demo foundation', () => {
  it('should initialize telemetry without crashing', () => {
    expect(() => initTelemetry()).not.toThrow();
  });
});

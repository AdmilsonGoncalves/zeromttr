import { describe, it, expect } from 'vitest';
import { initDashboard } from '../src/main.js';

describe('dashboard foundation', () => {
  it('should initialize dashboard', () => {
    const res = initDashboard();
    expect(res.status).toBe('initialized');
  });
});

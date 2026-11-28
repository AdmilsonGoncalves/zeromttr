import '@angular/compiler';
import { isDevMode } from '@angular/core';
import { describe, it, expect } from 'vitest';
import { configureAngularRuntimeMode, initDashboard } from '../../src/main.js';

describe('dashboard foundation', () => {
  it('should initialize dashboard', () => {
    const res = initDashboard();
    expect(res.status).toBe('initialized');
  });

  it('should_enable_angular_prod_mode_only_when_running_production_bundle', () => {
    expect(configureAngularRuntimeMode(false)).toBe(false);
    expect(isDevMode()).toBe(true);

    expect(configureAngularRuntimeMode(true)).toBe(true);
    expect(isDevMode()).toBe(false);
  });
});

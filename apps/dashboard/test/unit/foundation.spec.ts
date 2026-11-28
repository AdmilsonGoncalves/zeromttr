import '@angular/compiler';
import { enableProdMode, isDevMode } from '@angular/core';
import { describe, it, expect, vi } from 'vitest';
import { configureAngularRuntimeMode, initDashboard } from '../../src/main.js';

vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, enableProdMode: vi.fn() };
});

describe('dashboard foundation', () => {
  it('should initialize dashboard', () => {
    const res = initDashboard();
    expect(res.status).toBe('initialized');
  });

  it('should_enable_angular_prod_mode_only_when_running_production_bundle', () => {
    expect(configureAngularRuntimeMode(false)).toBe(false);
    expect(enableProdMode).not.toHaveBeenCalled();

    expect(configureAngularRuntimeMode(true)).toBe(true);
    expect(enableProdMode).toHaveBeenCalledTimes(1);
    expect(isDevMode()).toBe(true);
  });
});

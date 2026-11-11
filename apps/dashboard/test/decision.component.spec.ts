import '@angular/compiler';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ActivatedRoute } from '@angular/router';
import { DecisionComponent } from '../src/app/decision/decision.component.js';
import { I18nService, IncidentService } from '../src/app/core/index.js';

describe('DecisionComponent', () => {
  let component: DecisionComponent;
  let i18n: I18nService;
  let incidentService: IncidentService;
  let mockRoute: Partial<ActivatedRoute>;

  const originalWindow = globalThis.window;

  beforeEach(() => {
    i18n = new I18nService();
    incidentService = new IncidentService();

    mockRoute = {
      snapshot: {
        paramMap: {
          get: (key: string) => (key === 'id' ? 'inc-20261110-001' : null)
        }
      } as unknown as ActivatedRoute['snapshot']
    };

    component = new DecisionComponent(mockRoute as ActivatedRoute, i18n, incidentService);
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  it('should initialize incident ID from route parameters', () => {
    (globalThis as unknown as { window: { location: { hash: string } } }).window = {
      location: { hash: '' }
    };

    component.ngOnInit();
    expect(component.incidentId()).toBe('inc-20261110-001');
    expect(component.isValid()).toBe(false);
    expect(component.errorMessage()).toContain('Fragmento HMAC ausente');
  });

  it('should parse valid hash fragment correctly without leaking into query params', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    (globalThis as unknown as { window: { location: { hash: string } } }).window = {
      location: { hash: `#action=approve&sig=hmac_secret_sig_xyz&exp=${futureExp}` }
    };

    component.ngOnInit();
    expect(component.isValid()).toBe(true);
    expect(component.isExpired()).toBe(false);
    expect(component.action()).toBe('approve');
    expect(component.sig()).toBe('hmac_secret_sig_xyz');
    expect(component.exp()).toBe(futureExp);
    expect(component.expirationFormatted()).toContain('UTC');
    expect(component.errorMessage()).toBe('');
  });

  it('should detect expired tokens in hash fragment', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    (globalThis as unknown as { window: { location: { hash: string } } }).window = {
      location: { hash: `#action=reject&sig=hmac_secret_sig_xyz&exp=${pastExp}` }
    };

    component.ngOnInit();
    expect(component.isValid()).toBe(false);
    expect(component.isExpired()).toBe(true);
    expect(component.errorMessage()).toContain('expirou');
  });

  it('should reject invalid action parameter', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    (globalThis as unknown as { window: { location: { hash: string } } }).window = {
      location: { hash: `#action=invalid_action&sig=hmac_sig&exp=${futureExp}` }
    };

    component.ngOnInit();
    expect(component.isValid()).toBe(false);
    expect(component.errorMessage()).toContain('action inválido');
  });

  it('should reject missing signature', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    (globalThis as unknown as { window: { location: { hash: string } } }).window = {
      location: { hash: `#action=approve&exp=${futureExp}` }
    };

    component.ngOnInit();
    expect(component.isValid()).toBe(false);
    expect(component.errorMessage()).toContain('sig HMAC ausente');
  });

  it('should execute decision submitting payload via POST and update status to success', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    (globalThis as unknown as { window: { location: { hash: string } } }).window = {
      location: { hash: `#action=approve&sig=hmac_valid_sig&exp=${futureExp}` }
    };

    const submitSpy = vi.spyOn(incidentService, 'submitDecision').mockResolvedValue(true);

    component.ngOnInit();
    expect(component.isValid()).toBe(true);

    await component.executeDecision();
    expect(submitSpy).toHaveBeenCalledWith('inc-20261110-001', {
      action: 'approve',
      sig: 'hmac_valid_sig',
      exp: futureExp
    });
    expect(component.status()).toBe('success');
  });

  it('should set status to error when submitDecision fails', async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    (globalThis as unknown as { window: { location: { hash: string } } }).window = {
      location: { hash: `#action=reject&sig=hmac_invalid&exp=${futureExp}` }
    };

    vi.spyOn(incidentService, 'submitDecision').mockResolvedValue(false);

    component.ngOnInit();
    await component.executeDecision();
    expect(component.status()).toBe('error');
  });
});

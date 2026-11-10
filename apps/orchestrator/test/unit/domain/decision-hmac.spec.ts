import { describe, it, expect } from 'vitest';
import { DecisionHmac } from '../../../src/domain/index.js';

describe('DecisionHmac', () => {
  const secret = 'super-secret-hmac-key-zeromttr-2026';
  const incidentId = 'inc-live-demo-golden';
  const action = 'approve';
  const now = 1730000000;
  const exp = now + 900; // 15 min TTL

  it('should sign and verify valid HMAC signatures within TTL', () => {
    const sig = DecisionHmac.sign(incidentId, action, exp, secret);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBe(64); // SHA-256 hex

    const isValid = DecisionHmac.verify(incidentId, action, sig, exp, now, secret);
    expect(isValid).toBe(true);
  });

  it('should reject signatures when exp is in the past (expired)', () => {
    const pastExp = now - 1;
    const sig = DecisionHmac.sign(incidentId, action, pastExp, secret);

    const isValid = DecisionHmac.verify(incidentId, action, sig, pastExp, now, secret);
    expect(isValid).toBe(false);
  });

  it('should reject tampered action, incidentId, or secret', () => {
    const sig = DecisionHmac.sign(incidentId, action, exp, secret);

    // Tampered action
    expect(DecisionHmac.verify(incidentId, 'reject', sig, exp, now, secret)).toBe(false);

    // Tampered incidentId
    expect(DecisionHmac.verify('inc-other-id', action, sig, exp, now, secret)).toBe(false);

    // Wrong secret
    expect(DecisionHmac.verify(incidentId, action, sig, exp, now, 'wrong-secret')).toBe(false);

    // Tampered signature string
    const tamperedSig = sig.slice(0, -4) + '0000';
    expect(DecisionHmac.verify(incidentId, action, tamperedSig, exp, now, secret)).toBe(false);
  });

  it('should handle malformed or invalid hex signatures gracefully without crashing', () => {
    expect(DecisionHmac.verify(incidentId, action, 'invalid-short-sig', exp, now, secret)).toBe(
      false
    );
    expect(DecisionHmac.verify(incidentId, action, '', exp, now, secret)).toBe(false);
  });

  it('should reject non-finite or NaN expiration values strictly', () => {
    const sig = DecisionHmac.sign(incidentId, action, exp, secret);
    expect(DecisionHmac.verify(incidentId, action, sig, Number.NaN, now, secret)).toBe(false);
    expect(
      DecisionHmac.verify(incidentId, action, sig, Number.POSITIVE_INFINITY, now, secret)
    ).toBe(false);
    expect(DecisionHmac.verify(incidentId, action, sig, 'not-a-number' as any, now, secret)).toBe(
      false
    );
    expect(DecisionHmac.verify(incidentId, action, sig, exp, Number.NaN, secret)).toBe(false);
  });
});

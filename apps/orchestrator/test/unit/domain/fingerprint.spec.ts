import { describe, it, expect } from 'vitest';
import { computeAlertFingerprint } from '../../../src/domain/index.js';

describe('computeAlertFingerprint', () => {
  it('should generate deterministic fingerprint for given alert labels', () => {
    const labels1 = { alertname: 'PaymentServicePoolExhaustion', service: 'api-pagamentos-core' };
    const labels2 = { alertname: 'PaymentServicePoolExhaustion', service: 'api-pagamentos-core' };

    expect(computeAlertFingerprint(labels1)).toBe(computeAlertFingerprint(labels2));
    expect(computeAlertFingerprint(labels1)).toBe(
      'PaymentServicePoolExhaustion:api-pagamentos-core'
    );
  });

  it('should differentiate between distinct alerts or services', () => {
    const fp1 = computeAlertFingerprint({
      alertname: 'PaymentServicePoolExhaustion',
      service: 'api-pagamentos-core'
    });
    const fp2 = computeAlertFingerprint({
      alertname: 'HighLatencyAlert',
      service: 'api-pagamentos-core'
    });
    const fp3 = computeAlertFingerprint({
      alertname: 'PaymentServicePoolExhaustion',
      service: 'checkout-service'
    });

    expect(fp1).not.toBe(fp2);
    expect(fp1).not.toBe(fp3);
  });
});

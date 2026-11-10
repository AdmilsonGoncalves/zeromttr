import { createHmac, timingSafeEqual } from 'node:crypto';
import { isNonEmptyString } from '@zeromttr/utils';
import type { IncidentDecisionAction } from './incident.js';

export class DecisionHmac {
  public static createCanonicalMessage(
    incidentId: string,
    action: IncidentDecisionAction | string,
    exp: number
  ): string {
    return `${incidentId}:${action}:${exp}`;
  }

  public static sign(
    incidentId: string,
    action: IncidentDecisionAction | string,
    exp: number,
    secret: string
  ): string {
    const canonical = this.createCanonicalMessage(incidentId, action, exp);
    return createHmac('sha256', secret).update(canonical).digest('hex');
  }

  public static verify(
    incidentId: string,
    action: IncidentDecisionAction | string,
    sig: string,
    exp: number,
    now: number,
    secret: string
  ): boolean {
    if (!isNonEmptyString(sig) || !isNonEmptyString(incidentId)) {
      return false;
    }
    if (
      typeof exp !== 'number' ||
      !Number.isFinite(exp) ||
      typeof now !== 'number' ||
      !Number.isFinite(now) ||
      exp <= now
    ) {
      return false;
    }

    const expected = this.sign(incidentId, action, exp, secret);
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expectedBuf.length || sigBuf.length === 0) {
      return false;
    }

    try {
      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  }
}

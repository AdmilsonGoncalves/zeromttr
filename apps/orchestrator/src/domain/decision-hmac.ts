import { createHmac, timingSafeEqual } from 'node:crypto';
import { isNonEmptyString, isNumber } from '@zeromttr/utils';
import type { IncidentDecisionAction } from './incident.js';

export class DecisionHmac {
  /**
   * Builds the canonical string signed in decision HMAC tokens (`incidentId:action:exp`).
   */
  public static createCanonicalMessage(
    incidentId: string,
    action: IncidentDecisionAction | string,
    exp: number
  ): string {
    return `${incidentId}:${action}:${exp}`;
  }

  /**
   * Generates an HMAC-SHA256 hex signature for an incident decision payload.
   */
  public static sign(
    incidentId: string,
    action: IncidentDecisionAction | string,
    exp: number,
    secret: string
  ): string {
    const canonical = this.createCanonicalMessage(incidentId, action, exp);
    return createHmac('sha256', secret).update(canonical).digest('hex');
  }

  /**
   * Verifies expiration and constant-time HMAC-SHA256 validity of a decision token.
   */
  public static verify(
    incidentId: string,
    action: IncidentDecisionAction | string,
    sig: string,
    exp: unknown,
    now: unknown,
    secret: string
  ): boolean {
    if (!isNonEmptyString(sig) || !isNonEmptyString(incidentId)) {
      return false;
    }
    if (!/^[0-9a-f]{64}$/i.test(sig)) {
      return false;
    }
    if (!isNumber(exp) || !isNumber(now) || exp <= now) {
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

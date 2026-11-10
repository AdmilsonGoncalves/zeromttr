import { isNonEmptyString } from '@zeromttr/utils';
import { PII_PATTERNS, EDGE_REDACTED_PATTERN } from './pii-prompt-guard.patterns.js';

export interface PiiGuardAudit {
  leakedPatternsDetected: number;
  detectedTypes: string[];
  edgeRedactedTokensVerified: number;
  passed: boolean;
}

export function isValidCpf(digits: string): boolean {
  if (digits.length !== 11) {
    return false;
  }
  if (/^(\d)\1{10}$/.test(digits)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits[i]) * (10 - i);
  }
  let firstCheck = (sum * 10) % 11;
  if (firstCheck === 10 || firstCheck === 11) {
    firstCheck = 0;
  }
  if (firstCheck !== Number(digits[9])) {
    return false;
  }

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(digits[i]) * (11 - i);
  }
  let secondCheck = (sum * 10) % 11;
  if (secondCheck === 10 || secondCheck === 11) {
    secondCheck = 0;
  }
  if (secondCheck !== Number(digits[10])) {
    return false;
  }

  return true;
}

export function isValidCnpj(digits: string): boolean {
  if (digits.length !== 14) {
    return false;
  }
  if (/^(\d)\1{13}$/.test(digits)) {
    return false;
  }

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits[i]) * weights1[i];
  }
  const rem1 = sum % 11;
  const firstCheck = rem1 < 2 ? 0 : 11 - rem1;
  if (firstCheck !== Number(digits[12])) {
    return false;
  }

  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += Number(digits[i]) * weights2[i];
  }
  const rem2 = sum % 11;
  const secondCheck = rem2 < 2 ? 0 : 11 - rem2;
  if (secondCheck !== Number(digits[13])) {
    return false;
  }

  return true;
}

export class PiiPromptGuard {
  public static inspectAndEnforceFailClosed(promptText: string): PiiGuardAudit {
    if (!isNonEmptyString(promptText)) {
      return {
        leakedPatternsDetected: 0,
        detectedTypes: [],
        edgeRedactedTokensVerified: 0,
        passed: true
      };
    }

    let leakedCount = 0;
    const detectedTypes: string[] = [];

    // Count edge-redacted tokens verified
    EDGE_REDACTED_PATTERN.lastIndex = 0;
    const edgeMatches = Array.from(promptText.matchAll(EDGE_REDACTED_PATTERN));
    EDGE_REDACTED_PATTERN.lastIndex = 0;
    const edgeRedactedTokensVerified = edgeMatches.length;

    // Check dotted CPF
    if (PII_PATTERNS.cpfDotted.test(promptText)) {
      leakedCount++;
      detectedTypes.push('cpf_dotted');
    }

    // Check dotted CNPJ
    if (PII_PATTERNS.cnpjDotted.test(promptText)) {
      leakedCount++;
      detectedTypes.push('cnpj_dotted');
    }

    // Check digits11 with modulo 11
    PII_PATTERNS.digits11.lastIndex = 0;
    const matches11 = Array.from(promptText.matchAll(PII_PATTERNS.digits11));
    PII_PATTERNS.digits11.lastIndex = 0;

    let validCpfCandidatesCount = 0;
    for (const match of matches11) {
      if (isValidCpf(match[0])) {
        validCpfCandidatesCount++;
      }
    }
    if (validCpfCandidatesCount > 0) {
      leakedCount += validCpfCandidatesCount;
      detectedTypes.push('cpf_digits11');
    }

    // Check digits14 with modulo 11
    PII_PATTERNS.digits14.lastIndex = 0;
    const matches14 = Array.from(promptText.matchAll(PII_PATTERNS.digits14));
    PII_PATTERNS.digits14.lastIndex = 0;

    let validCnpjCandidatesCount = 0;
    for (const match of matches14) {
      if (isValidCnpj(match[0])) {
        validCnpjCandidatesCount++;
      }
    }
    if (validCnpjCandidatesCount > 0) {
      leakedCount += validCnpjCandidatesCount;
      detectedTypes.push('cnpj_digits14');
    }

    // Check JWT
    if (PII_PATTERNS.jwt.test(promptText)) {
      leakedCount++;
      detectedTypes.push('jwt');
    }

    // Check Bearer
    if (PII_PATTERNS.bearer.test(promptText)) {
      leakedCount++;
      detectedTypes.push('bearer');
    }

    // Check Email
    if (PII_PATTERNS.email.test(promptText)) {
      leakedCount++;
      detectedTypes.push('email');
    }

    // Check Phone
    if (PII_PATTERNS.phone.test(promptText)) {
      leakedCount++;
      detectedTypes.push('phone');
    }

    // Check EVP PIX
    if (PII_PATTERNS.evpPix.test(promptText)) {
      leakedCount++;
      detectedTypes.push('evp_pix');
    }

    return {
      leakedPatternsDetected: leakedCount,
      detectedTypes,
      edgeRedactedTokensVerified,
      passed: leakedCount === 0
    };
  }
}

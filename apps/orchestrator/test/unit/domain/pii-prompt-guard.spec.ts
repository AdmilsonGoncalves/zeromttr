import { describe, it, expect } from 'vitest';
import { PiiPromptGuard } from '../../../src/domain/index.js';

describe('PiiPromptGuard (Fail-Closed)', () => {
  it('should pass cleanly with zero leaked patterns for sanitized logs with REDACTED tokens', () => {
    const cleanLog =
      'INFO [api-pagamentos-core] Payment processed for payer CPF [REDACTED_CPF] merchant [REDACTED_CNPJ] token Bearer [REDACTED_TOKEN]';
    const audit = PiiPromptGuard.inspectAndEnforceFailClosed(cleanLog);

    expect(audit.passed).toBe(true);
    expect(audit.leakedPatternsDetected).toBe(0);
    expect(audit.detectedTypes).toEqual([]);
    expect(audit.edgeRedactedTokensVerified).toBe(3);
  });

  it('should detect dotted CPF and CNPJ regardless of check digits', () => {
    const text = 'Payer CPF 123.456.789-00 and merchant CNPJ 12.345.678/0001-99 in log body';
    const audit = PiiPromptGuard.inspectAndEnforceFailClosed(text);

    expect(audit.passed).toBe(false);
    expect(audit.leakedPatternsDetected).toBeGreaterThanOrEqual(2);
    expect(audit.detectedTypes).toContain('cpf_dotted');
    expect(audit.detectedTypes).toContain('cnpj_dotted');
  });

  it('should validate 11-digit raw numbers with modulo 11, rejecting invalid digits or repeated numbers', () => {
    // 11144477735 is a valid CPF
    const validCpf = 'Customer account 11144477735 registered';
    const auditValid = PiiPromptGuard.inspectAndEnforceFailClosed(validCpf);
    expect(auditValid.passed).toBe(false);
    expect(auditValid.detectedTypes).toContain('cpf_digits11');

    // Repeated numbers e.g. 11111111111 should NOT be flagged
    const repeated = 'Internal sequence 11111111111 order';
    const auditRepeated = PiiPromptGuard.inspectAndEnforceFailClosed(repeated);
    expect(auditRepeated.detectedTypes).not.toContain('cpf_digits11');

    // Invalid check digits e.g. 12345678901 should NOT be flagged
    const invalidCpf = 'Arbitrary order 12345678901 item';
    const auditInvalid = PiiPromptGuard.inspectAndEnforceFailClosed(invalidCpf);
    expect(auditInvalid.detectedTypes).not.toContain('cpf_digits11');
  });

  it('should detect CPF candidates at sentence boundaries (dots, underscores, hyphens)', () => {
    // Valid CPF followed by period
    const dotEnd = 'Payer registered with CPF 11144477735.';
    const auditDot = PiiPromptGuard.inspectAndEnforceFailClosed(dotEnd);
    expect(auditDot.detectedTypes).toContain('cpf_digits11');

    // With underscore
    const under = 'User record user_11144477735 updated';
    const auditUnder = PiiPromptGuard.inspectAndEnforceFailClosed(under);
    expect(auditUnder.detectedTypes).toContain('cpf_digits11');

    // With hyphen
    const hyphen = 'Reference CPF-11144477735 confirmed';
    const auditHyphen = PiiPromptGuard.inspectAndEnforceFailClosed(hyphen);
    expect(auditHyphen.detectedTypes).toContain('cpf_digits11');
  });

  it('should not produce false positives on telemetry identifiers (trace_id, commit sha, floats, unix timestamps)', () => {
    const telemetryText = `
      trace_id=4bf92f3577b34da6a3ce929d0e0e4736
      span_id=00f067aa0ba902b7
      commit_sha=8f14e45fceea167a5a36dedd4bea2543d1a2b3c4
      duration_ms=4512.11144477735
      ratio=11144477735.99
      timestamp=1730000000
      timestamp_ms=1730000000000
    `;
    const audit = PiiPromptGuard.inspectAndEnforceFailClosed(telemetryText);
    expect(audit.passed).toBe(true);
    expect(audit.leakedPatternsDetected).toBe(0);
  });

  it('should detect unmasked JWT and raw Bearer tokens', () => {
    const rawJwt = 'auth token is eyJhbGciOiJIUzI1NiJ9.payload.sig';
    const auditJwt = PiiPromptGuard.inspectAndEnforceFailClosed(rawJwt);
    expect(auditJwt.passed).toBe(false);
    expect(auditJwt.detectedTypes).toContain('jwt');

    const rawBearer = 'Authorization: Bearer secretTokenValue12345678==';
    const auditBearer = PiiPromptGuard.inspectAndEnforceFailClosed(rawBearer);
    expect(auditBearer.passed).toBe(false);
    expect(auditBearer.detectedTypes).toContain('bearer');
  });

  it('should detect leaked email addresses while ignoring git SSH URLs and github noreply addresses', () => {
    const leakedEmail = 'Contact the author at john.doe@empresa.com.br';
    const auditLeaked = PiiPromptGuard.inspectAndEnforceFailClosed(leakedEmail);
    expect(auditLeaked.passed).toBe(false);
    expect(auditLeaked.detectedTypes).toContain('email');

    const gitSsh = 'Cloning repo from git@github.com:AdmilsonGoncalves/zeromttr.git successfully';
    const auditGit = PiiPromptGuard.inspectAndEnforceFailClosed(gitSsh);
    expect(auditGit.detectedTypes).not.toContain('email');

    const gitHubNoReply = 'Committed by 12345+admilson@users.noreply.github.com';
    const auditNoReply = PiiPromptGuard.inspectAndEnforceFailClosed(gitHubNoReply);
    expect(auditNoReply.detectedTypes).not.toContain('email');
  });

  it('should detect phone numbers with ANATEL DDDs and mobile/landline patterns', () => {
    const phone1 = 'Telefone para contato: (11) 98765-4321';
    expect(PiiPromptGuard.inspectAndEnforceFailClosed(phone1).detectedTypes).toContain('phone');

    const phone2 = 'Ligue para +55 11 987654321 imediatamente';
    expect(PiiPromptGuard.inspectAndEnforceFailClosed(phone2).detectedTypes).toContain('phone');

    const phone3 = 'whatsapp: 11987654321';
    expect(PiiPromptGuard.inspectAndEnforceFailClosed(phone3).detectedTypes).toContain('phone');
  });

  it('should detect EVP PIX keys only when prefixed by contextual label', () => {
    const pixKey = 'chave_pix: 123e4567-e89b-42d3-a456-426614174000';
    const auditPix = PiiPromptGuard.inspectAndEnforceFailClosed(pixKey);
    expect(auditPix.detectedTypes).toContain('evp_pix');

    // Unprefixed UUID v4 (common request_id) should NOT trigger evp_pix
    const requestId = 'request_id: 123e4567-e89b-42d3-a456-426614174000';
    const auditReq = PiiPromptGuard.inspectAndEnforceFailClosed(requestId);
    expect(auditReq.detectedTypes).not.toContain('evp_pix');
  });

  it('should validate 14-digit raw numbers with modulo 11, detecting valid CNPJ and rejecting invalid', () => {
    // 12345678000195 is a valid CNPJ
    const validCnpj = 'Company CNPJ 12345678000195 in audit';
    const auditValid = PiiPromptGuard.inspectAndEnforceFailClosed(validCnpj);
    expect(auditValid.passed).toBe(false);
    expect(auditValid.detectedTypes).toContain('cnpj_digits14');

    // Repeated numbers e.g. 11111111111111 should NOT be flagged
    const repeated = 'Internal sequence 11111111111111 batch';
    const auditRepeated = PiiPromptGuard.inspectAndEnforceFailClosed(repeated);
    expect(auditRepeated.detectedTypes).not.toContain('cnpj_digits14');

    // Invalid check digits e.g. 12345678000100 should NOT be flagged
    const invalidCnpj = 'Transaction reference 12345678000100 id';
    const auditInvalid = PiiPromptGuard.inspectAndEnforceFailClosed(invalidCnpj);
    expect(auditInvalid.detectedTypes).not.toContain('cnpj_digits14');
  });

  it('should guarantee lastIndex safety across consecutive executions on identical text', () => {
    const candidateText = 'CPF 11144477735 and CNPJ 12345678000195 in audit';

    const firstRun = PiiPromptGuard.inspectAndEnforceFailClosed(candidateText);
    const secondRun = PiiPromptGuard.inspectAndEnforceFailClosed(candidateText);
    const thirdRun = PiiPromptGuard.inspectAndEnforceFailClosed(candidateText);

    expect(firstRun).toEqual(secondRun);
    expect(secondRun).toEqual(thirdRun);
  });
});

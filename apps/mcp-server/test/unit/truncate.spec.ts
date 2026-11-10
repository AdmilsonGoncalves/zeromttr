import { describe, it, expect } from 'vitest';
import {
  truncateLines,
  truncateDiff,
  sanitizeCommitMessage,
  sanitizeAuthorLogin,
  LogTruncator
} from '../../src/domain/truncate.js';

describe('Truncate and Sanitization domain', () => {
  it('should truncate lines exceeding maxLines (100) and line length (500 chars)', () => {
    const longLine = 'a'.repeat(600);
    const lines = Array.from({ length: 150 }, (_, i) => `${i}: ${longLine}`);

    const truncated = LogTruncator.truncateLines(lines, 100, 500);

    expect(truncated).toHaveLength(100);
    expect(truncated[0].length).toBeLessThanOrEqual(503); // 500 + '...'
    expect(truncated[0]).toContain('...');
  });

  it('should not modify lines that are already under length threshold', () => {
    const lines = ['short line 1', 'short line 2'];
    const result = truncateLines(lines, 100, 500);
    expect(result).toEqual(lines);
  });

  it('should truncate git diff exceeding 1500 chars', () => {
    const longDiff = 'diff --git a/file.ts b/file.ts\n' + '+ line addition\n'.repeat(200);
    expect(longDiff.length).toBeGreaterThan(1500);

    const truncated = truncateDiff(longDiff, 1500);
    expect(truncated.length).toBeLessThanOrEqual(1550);
    expect(truncated).toContain('[TRUNCATED_DIFF]');
  });

  it('should sanitize commit messages removing Co-authored-by lines with emails', () => {
    const commitMsg = `fix: resolve connection leak in payment repository\n\nCo-authored-by: Developer One <dev.one@corp.example.com>\nCo-authored-by: SRE Two <sre@example.org>\nReviewed-by: Admin`;
    const sanitized = sanitizeCommitMessage(commitMsg);

    expect(sanitized).not.toContain('dev.one@corp.example.com');
    expect(sanitized).not.toContain('sre@example.org');
    expect(sanitized).not.toContain('Co-authored-by:');
    expect(sanitized).toContain('fix: resolve connection leak in payment repository');
    expect(sanitized).toContain('Reviewed-by: Admin');
  });

  it('should sanitize author returning only login and discarding email', () => {
    const authorWithEmail = {
      login: 'admilson-dev',
      name: 'Admilson Gonçalves',
      email: 'admilson@private.corp'
    };
    const login = sanitizeAuthorLogin(authorWithEmail);
    expect(login).toBe('admilson-dev');
  });

  it('should fallback to username or unknown when author login is missing', () => {
    expect(sanitizeAuthorLogin({ name: 'developer' })).toBe('developer');
    expect(sanitizeAuthorLogin({})).toBe('unknown');
    expect(sanitizeAuthorLogin('string-user')).toBe('string-user');
  });
});

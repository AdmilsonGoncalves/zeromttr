import { describe, expect, it } from 'vitest';
import { toErrorMessage } from '../../src/error.utils.js';

describe('error.utils', () => {
  describe('toErrorMessage', () => {
    it('should extract message from Error instances', () => {
      const err = new Error('Database connection failed');
      expect(toErrorMessage(err)).toBe('Database connection failed');
    });

    it('should use string as message if error is string', () => {
      expect(toErrorMessage('Something broke')).toBe('Something broke');
    });

    it('should return fallback for non-error or empty error messages', () => {
      expect(toErrorMessage(null)).toBe('Internal error');
      expect(toErrorMessage(undefined, 'Custom fallback')).toBe('Custom fallback');
      expect(toErrorMessage({}, 'Custom fallback')).toBe('Custom fallback');
      expect(toErrorMessage(new Error(''), 'Fallback on empty')).toBe('Fallback on empty');
      expect(toErrorMessage(new Error('   '), 'Fallback on blank')).toBe('Fallback on blank');
    });
  });
});

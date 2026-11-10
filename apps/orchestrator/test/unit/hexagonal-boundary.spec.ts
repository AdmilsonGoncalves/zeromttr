import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import fs from 'node:fs';
import path from 'node:path';

describe('Hexagonal Boundary Architecture Guard', () => {
  it('should reject domain imports from adapters', async () => {
    const filePath = path.resolve(import.meta.dirname, '../../src/domain/temp-boundary-test.ts');
    try {
      fs.writeFileSync(
        filePath,
        "import { BaseIncidentAdapter } from '../adapters/index.js';\nexport const x = BaseIncidentAdapter;\n"
      );
      const eslint = new ESLint({ ignore: false });
      const results = await eslint.lintFiles([filePath]);
      const messages = results[0]?.messages.map((m) => m.message) || [];
      const hasBoundaryError = messages.some((msg) => msg.includes('Hexagonal boundary violation'));
      expect(hasBoundaryError).toBe(true);
    } finally {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }, 30_000);
});

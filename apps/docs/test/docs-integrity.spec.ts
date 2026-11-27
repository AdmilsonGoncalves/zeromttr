import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../docusaurus.config.js';
import sidebars from '../sidebars.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, '..');

function collectSidebarDocIds(): string[] {
  const manualSidebar = sidebars.manualSidebar;
  if (!Array.isArray(manualSidebar)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of manualSidebar) {
    if (typeof entry === 'string') {
      ids.push(entry);
    } else if (
      typeof entry === 'object' &&
      entry !== null &&
      'items' in entry &&
      Array.isArray(entry.items)
    ) {
      for (const item of entry.items) {
        if (typeof item === 'string') {
          ids.push(item);
        }
      }
    }
  }
  return ids;
}

describe('ZeroMTTR Docusaurus manual integrity', () => {
  const expectedLocales = ['pt-BR', 'en-US', 'es-ES'];
  const docIds = collectSidebarDocIds();

  it('should_declare_pt_br_as_default_locale_and_support_all_three_dashboard_languages', () => {
    expect(config.i18n?.defaultLocale).toBe('pt-BR');
    expect(config.i18n?.locales).toEqual(expectedLocales);
    expect(config.onBrokenLinks).toBe('throw');
  });

  it('should_have_every_sidebar_manual_present_in_pt_br_en_us_and_es_es', () => {
    expect(docIds.length).toBeGreaterThanOrEqual(10);

    for (const id of docIds) {
      const ptPath = resolve(APP_ROOT, 'manuals', `${id}.md`);
      const enPath = resolve(
        APP_ROOT,
        'i18n/en-US/docusaurus-plugin-content-docs/current',
        `${id}.md`
      );
      const esPath = resolve(
        APP_ROOT,
        'i18n/es-ES/docusaurus-plugin-content-docs/current',
        `${id}.md`
      );

      expect(existsSync(ptPath), `Missing pt-BR manual: ${ptPath}`).toBe(true);
      expect(existsSync(enPath), `Missing en-US manual: ${enPath}`).toBe(true);
      expect(existsSync(esPath), `Missing es-ES manual: ${esPath}`).toBe(true);

      const ptContent = readFileSync(ptPath, 'utf8');
      const enContent = readFileSync(enPath, 'utf8');
      const esContent = readFileSync(esPath, 'utf8');

      expect(ptContent).toContain(`id: ${id}`);
      expect(enContent).toContain(`id: ${id}`);
      expect(esContent).toContain(`id: ${id}`);

      const expectedSlug = id === 'introduction' ? 'slug: /' : `slug: /${id}`;
      expect(ptContent).toContain(expectedSlug);
      expect(enContent).toContain(expectedSlug);
      expect(esContent).toContain(expectedSlug);

      expect(ptContent).not.toMatch(/\bFSM\b/i);
      expect(enContent).not.toMatch(/\bFSM\b/i);
      expect(esContent).not.toMatch(/\bFSM\b/i);

      if (id === 'introduction' || id === 'architecture' || id === 'scope-and-limits') {
        expect(ptContent).not.toMatch(/v2\.14\.\d+|api-pagamentos-core/i);
        expect(enContent).not.toMatch(/v2\.14\.\d+|api-pagamentos-core/i);
        expect(esContent).not.toMatch(/v2\.14\.\d+|api-pagamentos-core/i);
      }
    }
  });

  it('should_include_valid_i18n_theme_and_sidebar_json_for_secondary_locales', () => {
    for (const locale of ['en-US', 'es-ES']) {
      const files = [
        `i18n/${locale}/docusaurus-theme-classic/navbar.json`,
        `i18n/${locale}/docusaurus-theme-classic/footer.json`,
        `i18n/${locale}/docusaurus-plugin-content-docs/current.json`
      ];
      for (const relativePath of files) {
        const fullPath = resolve(APP_ROOT, relativePath);
        expect(existsSync(fullPath), `Missing i18n file: ${fullPath}`).toBe(true);
        const parsed = JSON.parse(readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
        expect(Object.keys(parsed).length).toBeGreaterThan(0);
      }
    }
  });
});

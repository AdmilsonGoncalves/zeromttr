import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nService, Language } from '../../../src/app/core/i18n/i18n.service.js';
import {
  WarRoomHeaderComponent,
  resolveDocsManualUrl
} from '../../../src/app/war-room/war-room-header/war-room-header.component.js';
import { createWithInjector } from '../../helpers/di.helper.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HEADER_TEMPLATE_PATH = resolve(
  HERE,
  '../../../src/app/war-room/war-room-header/war-room-header.component.html'
);

describe('WarRoomHeaderComponent', () => {
  let i18n: I18nService;
  let component: WarRoomHeaderComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = createWithInjector(WarRoomHeaderComponent, [
      { provide: I18nService, useValue: i18n }
    ]);
  });

  it('should emit langChange for valid inputs and ignore empty language', () => {
    const langSpy = vi.fn();
    component.langChange.subscribe(langSpy);

    component.onLangSelect(Language.EN_US);
    expect(langSpy).toHaveBeenCalledWith(Language.EN_US);

    component.onLangSelect('' as unknown as Language);
    expect(langSpy).toHaveBeenCalledTimes(1);
  });

  it('should track demoModeEnabled and requireDemoKey inputs in signals', () => {
    expect(component.demoModeEnabledSignal()).toBe(false);
    expect(component.requireDemoKeySignal()).toBe(true);

    component.demoModeEnabled = true;
    component.requireDemoKey = false;

    expect(component.demoModeEnabledSignal()).toBe(true);
    expect(component.requireDemoKeySignal()).toBe(false);
  });

  it('should delegate demo drawer controls to app-demo-settings and keep header pure', () => {
    const html = readFileSync(HEADER_TEMPLATE_PATH, 'utf8');
    expect(html).not.toContain('<ng-content');
    expect(html).not.toContain('finopsPayloadReduction');
    expect(html).not.toContain('kpiTtdLabel');
    expect(html).not.toContain('turnstileContainer');
    expect(html).toContain('<app-demo-settings');
    expect(html).toContain('<app-system-settings');
    expect(html).toContain('<app-locale-switcher');
    expect(html).toContain('ms-auto');
    expect(html).not.toContain('<p-selectbutton');
    expect(html).not.toContain('<p-drawer');
    expect(html).not.toContain('liveKeyPlaceholder');
    expect(html).not.toContain('langOptions');
  });

  it('should_render_distinct_unreachable_status_label_and_severity_in_header', () => {
    const html = readFileSync(HEADER_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('healthStatus.UNREACHABLE');
    expect(html).toContain("i18n.t('unreachable')");
    expect(i18n.t('unreachable')).toBeTruthy();
  });

  it('should_resolve_docs_manual_url_for_all_locales_and_environments', () => {
    expect(resolveDocsManualUrl(Language.PT_BR, { hostname: 'zeromttr.agjworks.com' })).toBe(
      'https://docs.zeromttr.agjworks.com/'
    );
    expect(resolveDocsManualUrl(Language.EN_US, { hostname: 'zeromttr.agjworks.com' })).toBe(
      'https://docs.zeromttr.agjworks.com/en-US/'
    );
    expect(resolveDocsManualUrl(Language.ES_ES, { hostname: 'zeromttr.agjworks.com' })).toBe(
      'https://docs.zeromttr.agjworks.com/es-ES/'
    );
    expect(resolveDocsManualUrl(Language.PT_BR, { hostname: 'localhost' })).toBe(
      'http://localhost:4300/'
    );
    expect(resolveDocsManualUrl(Language.ES_ES, { hostname: '127.0.0.1' })).toBe(
      'http://localhost:4300/es-ES/'
    );
    expect(
      resolveDocsManualUrl(Language.EN_US, {
        configuredBaseUrl: 'https://docs.example.com///'
      })
    ).toBe('https://docs.example.com/en-US/');
  });

  it('should_update_docs_manual_url_signal_when_ui_language_changes_and_render_external_link', () => {
    const html = readFileSync(HEADER_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('[href]="docsManualUrl()"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("i18n.t('userManualAriaLabel')");

    i18n.setLang(Language.PT_BR);
    expect(component.docsManualUrl().endsWith('/')).toBe(true);
    expect(component.docsManualUrl()).not.toContain('/en-US/');

    i18n.setLang(Language.EN_US);
    expect(component.docsManualUrl().endsWith('/en-US/')).toBe(true);

    i18n.setLang(Language.ES_ES);
    expect(component.docsManualUrl().endsWith('/es-ES/')).toBe(true);
  });
});

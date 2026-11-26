import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentExecutionMode, TargetHealthStatus } from '../src/app/core/contract.js';
import { I18nService, Language } from '../src/app/core/i18n/i18n.service.js';
import { WarRoomHeaderComponent } from '../src/app/war-room/war-room-header/war-room-header.component.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HEADER_TEMPLATE_PATH = resolve(
  HERE,
  '../src/app/war-room/war-room-header/war-room-header.component.html'
);

describe('WarRoomHeaderComponent', () => {
  let i18n: I18nService;
  let component: WarRoomHeaderComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new WarRoomHeaderComponent(i18n);
  });

  it('should_emit_modeChange_liveKeyChange_and_langChange_for_valid_inputs', () => {
    const modeSpy = vi.fn();
    const keySpy = vi.fn();
    const langSpy = vi.fn();

    component.modeChange.subscribe(modeSpy);
    component.liveKeyChange.subscribe(keySpy);
    component.langChange.subscribe(langSpy);

    component.onModeSelect(IncidentExecutionMode.LIVE);
    component.onLiveKeyInput({ target: { value: 'secret-key' } } as unknown as Event);
    component.onLangSelect(Language.EN_US);

    expect(modeSpy).toHaveBeenCalledWith(IncidentExecutionMode.LIVE);
    expect(keySpy).toHaveBeenCalledWith('secret-key');
    expect(langSpy).toHaveBeenCalledWith(Language.EN_US);
  });

  it('should_ignore_empty_mode_language_or_missing_input_target', () => {
    const modeSpy = vi.fn();
    const keySpy = vi.fn();
    const langSpy = vi.fn();

    component.modeChange.subscribe(modeSpy);
    component.liveKeyChange.subscribe(keySpy);
    component.langChange.subscribe(langSpy);

    component.onModeSelect('' as unknown as typeof IncidentExecutionMode.LIVE);
    component.onLiveKeyInput({ target: null } as unknown as Event);
    component.onLangSelect('' as unknown as Language);

    expect(modeSpy).not.toHaveBeenCalled();
    expect(keySpy).not.toHaveBeenCalled();
    expect(langSpy).not.toHaveBeenCalled();
  });

  it('should_block_starting_healthy_traffic_while_target_is_degraded_unless_traffic_is_already_active', () => {
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(false);

    component.targetStatus = {
      status: TargetHealthStatus.DEGRADED,
      service: 'api-pagamentos-core',
      version: 'v2.14.8',
      previousHealthyVersion: 'v2.14.7',
      rawEdgeLogPreCollector: 'raw'
    };
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(true);

    component.healthyTrafficActive = true;
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(false);

    component.healthyTrafficActive = false;
    component.targetStatus = {
      status: TargetHealthStatus.HEALTHY,
      service: 'api-pagamentos-core',
      version: 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      rawEdgeLogPreCollector: 'raw'
    };
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(false);
  });

  it('should_toggle_responsive_mobile_command_menu_state', () => {
    expect(component.isMobileMenuOpenSignal()).toBe(false);
    component.toggleMobileMenu();
    expect(component.isMobileMenuOpenSignal()).toBe(true);
    component.toggleMobileMenu();
    expect(component.isMobileMenuOpenSignal()).toBe(false);
  });

  it('should_compute_reactive_modeOptions_labels_from_active_i18n_language', () => {
    expect(component.modeOptions().map((o) => o.label)).toEqual([
      i18n.t('liveMode'),
      i18n.t('replayMode')
    ]);

    i18n.setLang(Language.ES_ES);
    expect(component.modeOptions().map((o) => o.label)).toEqual([
      '⚡ Modo Live API',
      '🎬 Modo Replay (Grabado)'
    ]);
  });

  it('should_remain_a_pure_header_template_without_kpi_strips_finops_badges_notices_or_ng_content', () => {
    const html = readFileSync(HEADER_TEMPLATE_PATH, 'utf8');
    expect(html).not.toContain('<ng-content');
    expect(html).not.toContain('finopsPayloadReduction');
    expect(html).not.toContain('kpiTtdLabel');
    expect(html).not.toContain('turnstileContainer');
    expect(html).toContain('headerMenuBtn');
    expect(html).toContain('aria-controls="war-room-header-menu"');
    expect(html).toContain('<app-locale-switcher');
    expect(html).not.toContain('langOptions');
  });
});

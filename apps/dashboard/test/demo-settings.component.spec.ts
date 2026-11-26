import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentExecutionMode, TargetHealthStatus } from '../src/app/core/contract.js';
import { I18nService, Language } from '../src/app/core/i18n/i18n.service.js';
import { DemoSettingsComponent } from '../src/app/shared/demo-settings/demo-settings.component.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_SETTINGS_TEMPLATE_PATH = resolve(
  HERE,
  '../src/app/shared/demo-settings/demo-settings.component.html'
);

describe('DemoSettingsComponent', () => {
  let i18n: I18nService;
  let component: DemoSettingsComponent;

  beforeEach(() => {
    i18n = new I18nService();
    component = new DemoSettingsComponent(i18n);
  });

  it('should_open_and_close_drawer_and_close_automatically_on_triggerChaos_and_resetService', () => {
    const chaosSpy = vi.fn();
    const resetSpy = vi.fn();
    component.triggerChaos.subscribe(chaosSpy);
    component.resetService.subscribe(resetSpy);

    expect(component.isDrawerOpenSignal()).toBe(false);
    component.openDrawer();
    expect(component.isDrawerOpenSignal()).toBe(true);

    component.onTriggerChaos();
    expect(chaosSpy).toHaveBeenCalledTimes(1);
    expect(component.isDrawerOpenSignal()).toBe(false);

    component.onDrawerVisibilityChange(true);
    expect(component.isDrawerOpenSignal()).toBe(true);

    component.onResetService();
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(component.isDrawerOpenSignal()).toBe(false);
  });

  it('should_emit_modeChange_liveKeyChange_and_healthy_traffic_toggle_events_for_valid_inputs', () => {
    const modeSpy = vi.fn();
    const keySpy = vi.fn();
    const trafficSpy = vi.fn();

    component.modeChange.subscribe(modeSpy);
    component.liveKeyChange.subscribe(keySpy);
    component.toggleHealthyTraffic.subscribe(trafficSpy);

    component.onLiveModeToggle(true);
    expect(modeSpy).toHaveBeenCalledWith(IncidentExecutionMode.LIVE);

    component.onLiveModeToggle(false);
    expect(modeSpy).toHaveBeenLastCalledWith(IncidentExecutionMode.REPLAY);

    component.onLiveKeyInput({ target: { value: 'secret-key' } } as unknown as Event);
    expect(keySpy).toHaveBeenCalledWith('secret-key');

    component.activeMode = IncidentExecutionMode.LIVE;
    component.targetStatus = {
      status: TargetHealthStatus.HEALTHY,
      service: 'api-pagamentos-core',
      version: 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      capabilities: {
        chaosSimulation: true,
        healthyTrafficToggle: true
      }
    };

    component.onHealthyTrafficToggle(true);
    expect(trafficSpy).toHaveBeenCalledTimes(1);

    // Repeating same boolean state should not re-emit
    component.healthyTrafficActive = true;
    component.onHealthyTrafficToggle(true);
    expect(trafficSpy).toHaveBeenCalledTimes(1);
  });

  it('should_ignore_empty_mode_missing_input_target_or_mode_toggle_while_workflow_is_running', () => {
    const modeSpy = vi.fn();
    const keySpy = vi.fn();

    component.modeChange.subscribe(modeSpy);
    component.liveKeyChange.subscribe(keySpy);

    component.onModeSelect('' as unknown as typeof IncidentExecutionMode.LIVE);
    component.onLiveKeyInput({ target: null } as unknown as Event);
    component.isWorkflowRunning = true;
    component.onLiveModeToggle(true);

    expect(modeSpy).not.toHaveBeenCalled();
    expect(keySpy).not.toHaveBeenCalled();
  });

  it('should_disable_and_hide_live_key_value_when_requireDemoKey_is_false_and_restore_when_required', () => {
    component.liveDemoKey = 'persisted-local-storage-key';
    component.activeMode = IncidentExecutionMode.LIVE;

    component.requireDemoKey = false;
    expect(component.isLiveKeyInputDisabled()).toBe(true);
    expect(component.displayedLiveDemoKey()).toBe('');

    component.requireDemoKey = true;
    expect(component.isLiveKeyInputDisabled()).toBe(false);
    expect(component.displayedLiveDemoKey()).toBe('persisted-local-storage-key');

    component.activeMode = IncidentExecutionMode.REPLAY;
    expect(component.isLiveKeyInputDisabled()).toBe(true);
    expect(component.displayedLiveDemoKey()).toBe('persisted-local-storage-key');
  });

  it('should_block_starting_healthy_traffic_while_target_is_degraded_unless_already_active', () => {
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(false);

    component.activeMode = IncidentExecutionMode.LIVE;
    component.targetStatus = {
      status: TargetHealthStatus.DEGRADED,
      service: 'api-pagamentos-core',
      version: 'v2.14.8',
      previousHealthyVersion: 'v2.14.7',
      capabilities: {
        chaosSimulation: true,
        healthyTrafficToggle: true
      },
      rawEdgeLogPreCollector: 'raw'
    };
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(true);
    expect(component.isHealthyTrafficToggleDisabled()).toBe(true);

    component.healthyTrafficActive = true;
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(false);
    expect(component.isHealthyTrafficToggleDisabled()).toBe(false);

    component.healthyTrafficActive = false;
    component.targetStatus = {
      status: TargetHealthStatus.HEALTHY,
      service: 'api-pagamentos-core',
      version: 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      capabilities: {
        chaosSimulation: true,
        healthyTrafficToggle: true
      },
      rawEdgeLogPreCollector: 'raw'
    };
    expect(component.isHealthyTrafficStartBlockedSignal()).toBe(false);
    expect(component.isHealthyTrafficToggleDisabled()).toBe(false);
  });

  it('should_compute_reactive_hints_from_active_i18n_language', () => {
    expect(i18n.t('demoMenuBtn')).toBe('Demonstração');
    expect(i18n.t('demoMenuTitle')).toBe('Demonstração');

    component.requireDemoKey = false;
    expect(component.liveKeyHint()).toBe(i18n.t('demoMenuKeyNotRequiredHint'));

    i18n.setLang(Language.ES_ES);
    expect(component.liveKeyHint()).toBe(
      'Deshabilitada — el servidor está configurado para Modo Live público.'
    );
  });

  it('should_hide_chaos_and_traffic_controls_when_capabilities_are_explicitly_false', () => {
    component.activeMode = IncidentExecutionMode.LIVE;
    component.demoModeEnabled = true;
    component.targetStatus = {
      status: TargetHealthStatus.HEALTHY,
      service: 'external-orders-api',
      version: 'v3.1.0',
      previousHealthyVersion: 'v3.0.9',
      capabilities: {
        chaosSimulation: false,
        healthyTrafficToggle: false
      }
    };

    expect(component.canSimulateChaos()).toBe(false);
    expect(component.canToggleHealthyTraffic()).toBe(false);
    expect(component.showHealthyTrafficControl()).toBe(false);

    const html = readFileSync(DEMO_SETTINGS_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('@if (canSimulateChaos())');
    expect(html).toContain('@if (showHealthyTrafficControl())');
  });

  it('should_show_controls_in_replay_mode_with_healthy_traffic_toggle_disabled', () => {
    component.activeMode = IncidentExecutionMode.REPLAY;
    component.demoModeEnabled = true;
    component.targetStatus = {
      status: TargetHealthStatus.HEALTHY,
      service: 'api-pagamentos-core',
      version: 'v2.14.7',
      previousHealthyVersion: 'v2.14.7',
      capabilities: {
        chaosSimulation: true,
        healthyTrafficToggle: true
      }
    };

    expect(component.canSimulateChaos()).toBe(true);
    expect(component.canToggleHealthyTraffic()).toBe(false);
    expect(component.showHealthyTrafficControl()).toBe(true);
    expect(component.isHealthyTrafficToggleDisabled()).toBe(true);

    component.demoModeEnabled = false;
    expect(component.canSimulateChaos()).toBe(false);
    expect(component.showHealthyTrafficControl()).toBe(false);
  });

  it('should_render_demo_drawer_trigger_toggles_live_key_input_and_action_buttons_gated_on_demoModeEnabled', () => {
    const html = readFileSync(DEMO_SETTINGS_TEMPLATE_PATH, 'utf8');
    expect(html).toContain('@if (demoModeEnabledSignal())');
    expect(html).toContain('demoMenuBtn');
    expect(html).toContain('w-8 lg:w-auto');
    expect(html).toContain('hidden lg:inline');
    expect(html).toContain('hidden lg:inline-flex');
    expect(html).toContain('<p-drawer');
    expect(html).toContain('<p-toggleswitch');
    expect(html).toContain('demo-live-mode-toggle');
    expect(html).toContain('demo-live-key-input');
    expect(html).toContain('demo-healthy-traffic-toggle');
    expect(html).toContain('simulateIncident');
    expect(html).toContain('restoreService');
    expect(html).not.toContain('<app-locale-switcher');
  });
});

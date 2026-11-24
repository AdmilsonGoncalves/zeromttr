import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_INCIDENT } from '../mock-server/mock-data.js';
import { TelemetryHealthLevel } from '../src/app/core/constants.js';
import { IncidentExecutionMode } from '../src/app/core/contract.js';
import { I18nService } from '../src/app/core/i18n.service.js';
import { EvidencePanelComponent } from '../src/app/war-room/evidence-panel/evidence-panel.component.js';
import { FsmTimelineComponent } from '../src/app/war-room/fsm-timeline/fsm-timeline.component.js';
import { RemediationPanelComponent } from '../src/app/war-room/remediation-panel/remediation-panel.component.js';
import { TargetTelemetryComponent } from '../src/app/war-room/target-telemetry/target-telemetry.component.js';
import { WarRoomHeaderComponent } from '../src/app/war-room/war-room-header/war-room-header.component.js';
import { createInInjectionContext, setInputSignal } from './helpers/signal-input.helper.js';

describe('WarRoom child components', () => {
  let i18n: I18nService;

  beforeEach(() => {
    i18n = new I18nService();
  });

  it('WarRoomHeaderComponent should emit mode, liveKey and language changes', () => {
    const header = createInInjectionContext(() => new WarRoomHeaderComponent(i18n));
    const modeSpy = vi.fn();
    const keySpy = vi.fn();
    const langSpy = vi.fn();

    header.modeChange.subscribe(modeSpy);
    header.liveKeyChange.subscribe(keySpy);
    header.langChange.subscribe(langSpy);

    header.onModeSelect(IncidentExecutionMode.LIVE);
    header.onLiveKeyInput({ target: { value: 'secret-key' } } as unknown as Event);
    header.onLangSelect('en');

    expect(modeSpy).toHaveBeenCalledWith(IncidentExecutionMode.LIVE);
    expect(keySpy).toHaveBeenCalledWith('secret-key');
    expect(langSpy).toHaveBeenCalledWith('en');
  });

  it('FsmTimelineComponent should format hint with liveWaitSeconds signal', () => {
    const timeline = createInInjectionContext(() => new FsmTimelineComponent(i18n));
    setInputSignal(timeline.stages, []);
    setInputSignal(timeline.hintKey, 'fsmHintAwaitingAlert');
    setInputSignal(timeline.liveWaitSeconds, 17);

    expect(timeline.formattedHint()).toContain('17');
  });

  it('TargetTelemetryComponent should compute health levels, colors and pool meters from metrics signal', () => {
    const telemetry = createInInjectionContext(() => new TargetTelemetryComponent(i18n));
    setInputSignal(telemetry.metrics, {
      healthyTrafficActive: true,
      requestsPerSecond: 12,
      errorRate5xxPercent: 85,
      p95LatencyMs: 2400,
      poolActive: 10,
      poolMax: 10,
      poolWaiting: 4
    });

    expect(telemetry.error5xxLevel()).toBe(TelemetryHealthLevel.CRITICAL);
    expect(telemetry.error5xxColor()).toBe('#f43f5e');
    expect(telemetry.latencyLevel()).toBe(TelemetryHealthLevel.CRITICAL);
    expect(telemetry.poolLevel()).toBe(TelemetryHealthLevel.CRITICAL);
    expect(telemetry.poolMax()).toBe(14);
    expect(telemetry.poolMeters()).toHaveLength(2);
  });

  it('EvidencePanelComponent should extract clean body from Loki JSON envelope and update activeTab', () => {
    const evidence = createInInjectionContext(() => new EvidencePanelComponent(i18n));
    setInputSignal(evidence.signalsRatio, '4/4');
    setInputSignal(evidence.evidenceCoveragePercent, 100);
    setInputSignal(evidence.leakedPatternsCount, 0);
    setInputSignal(evidence.finopsReduction, 84);
    setInputSignal(evidence.estimatedTokensSaved, 10122);
    setInputSignal(evidence.isPiiPassed, true);

    const lokiEnvelopeIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    lokiEnvelopeIncident.rca.logSample =
      '{"body":"ERROR [api-pagamentos-core] Pool exhausted for CPF [REDACTED_CPF]","traceid":"abc"}\n{"body":"second line"}';
    setInputSignal(evidence.incident, lokiEnvelopeIncident);

    expect(evidence.mockGitDiff).toContain('acquireTimeoutMillis: 100');
    expect(evidence.displayedPostOttlLog()).toBe(
      'ERROR [api-pagamentos-core] Pool exhausted for CPF [REDACTED_CPF]'
    );

    evidence.onTabChange('2');
    expect(evidence.activeTab()).toBe('2');
  });

  it('RemediationPanelComponent should sanitize resend preview HTML safely across languages', () => {
    const remediation = createInInjectionContext(() => new RemediationPanelComponent(i18n));
    expect(remediation.safeResendPreview()).toContain('🚨 ZeroMTTR Incident Post-Mortem');

    const degradedIncident = JSON.parse(JSON.stringify(MOCK_INCIDENT));
    degradedIncident.notification = {
      emailId: 'email-fallback-1',
      status: 'degraded',
      htmlPreview: 'Warning: Resend delivery failed (403). Notification in degraded mode.'
    };
    setInputSignal(remediation.incident, degradedIncident);
    expect(remediation.safeResendPreview()).toContain(i18n.t('resendDegradedTitle'));

    i18n.setLang('en');
    expect(remediation.safeResendPreview()).toContain(i18n.t('resendDegradedTitle'));
    i18n.setLang('pt');
  });
});

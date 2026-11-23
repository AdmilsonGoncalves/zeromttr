import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { isNonEmptyString } from '@zeromttr/utils';
import { MessageService } from 'primeng/api';
import { Toast } from 'primeng/toast';
import { DecisionAction, type IncidentMode } from '../core/contract.js';
import { I18nService, type Language } from '../core/i18n.service.js';
import { IncidentService, type DemoActionResult } from '../core/incident.service.js';
import { EvidencePanelComponent } from './evidence-panel/evidence-panel.component.js';
import { FsmTimelineComponent } from './fsm-timeline/fsm-timeline.component.js';
import { RemediationPanelComponent } from './remediation-panel/remediation-panel.component.js';
import { TargetTelemetryComponent } from './target-telemetry/target-telemetry.component.js';
import { WarRoomHeaderComponent } from './war-room-header/war-room-header.component.js';

/**
 * Single-pane War Room mission control orchestrator composing quadrant child components via signals.
 */
@Component({
  selector: 'app-war-room',
  imports: [
    Toast,
    WarRoomHeaderComponent,
    FsmTimelineComponent,
    TargetTelemetryComponent,
    EvidencePanelComponent,
    RemediationPanelComponent
  ],
  providers: [MessageService],
  templateUrl: './war-room.component.html',
  styleUrl: './war-room.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomComponent implements OnInit, OnDestroy {
  readonly i18n: I18nService;
  readonly incidentService: IncidentService;
  readonly messageService: MessageService;

  constructor(...args: [I18nService?, IncidentService?, MessageService?]) {
    const [i18n, incidentService, messageService] = args;
    this.i18n = i18n ?? inject(I18nService);
    this.incidentService = incidentService ?? inject(IncidentService);
    if (messageService) {
      this.messageService = messageService;
    } else {
      try {
        this.messageService = inject(MessageService, { optional: true }) ?? new MessageService();
      } catch {
        this.messageService = new MessageService();
      }
    }
  }

  ngOnInit(): void {
    this.incidentService.connectSse();
    void this.incidentService.fetchDemoConfig();
    void this.incidentService.fetchTargetStatus();
    this.incidentService.startTargetStatusPolling();
    void this.incidentService.fetchIncidents();
  }

  ngOnDestroy(): void {
    this.incidentService.stopTargetStatusPolling();
    this.incidentService.disconnectSse();
  }

  /**
   * Applies the selected execution mode to the incident service.
   */
  onModeChange(mode: IncidentMode): void {
    if (isNonEmptyString(mode)) {
      this.incidentService.setActiveMode(mode);
    }
  }

  /**
   * Stores the live demo key in the incident service.
   */
  onLiveKeyChange(key: string): void {
    this.incidentService.setLiveDemoKey(key);
  }

  /**
   * Stores the active Cloudflare Turnstile token in the incident service.
   */
  onTurnstileTokenChange(token: string | null): void {
    this.incidentService.setTurnstileToken(token);
  }

  /**
   * Switches the active dashboard language.
   */
  onLangChange(lang: Language): void {
    if (isNonEmptyString(lang)) {
      this.i18n.setLang(lang);
    }
  }

  private notifyActionError(result: DemoActionResult): void {
    if (result.status === 403) {
      this.messageService.add({
        severity: 'error',
        summary: this.i18n.t('toastLiveKeyRequiredSummary'),
        detail: this.i18n.t('toastLiveKeyRequiredDetail'),
        life: 6000
      });
      return;
    }

    if (result.status === 429) {
      const detail =
        result.retryAfterSeconds !== undefined
          ? this.i18n
              .t('toastCooldownDetailWithSeconds')
              .replace('{N}', String(result.retryAfterSeconds))
          : this.i18n.t('toastCooldownDetail');
      this.messageService.add({
        severity: 'warn',
        summary: this.i18n.t('toastCooldownSummary'),
        detail,
        life: 6000
      });
      return;
    }

    const fallbackDetail = result.status
      ? `${this.i18n.t('toastActionErrorDetail')} (HTTP ${result.status})`
      : this.i18n.t('toastActionErrorDetail');
    this.messageService.add({
      severity: 'error',
      summary: this.i18n.t('toastActionErrorSummary'),
      detail: fallbackDetail,
      life: 6000
    });
  }

  /**
   * Toggles continuous healthy synthetic traffic on the target workload.
   */
  async onToggleHealthyTraffic(): Promise<void> {
    const nextEnable = !(this.incidentService.targetMetrics()?.healthyTrafficActive ?? false);
    const result = await this.incidentService.toggleHealthyTraffic(nextEnable);
    if (!result.ok) {
      this.notifyActionError(result);
      return;
    }

    this.messageService.add({
      severity: 'info',
      summary: this.i18n.t(
        nextEnable ? 'toastHealthyTrafficStartedSummary' : 'toastHealthyTrafficStoppedSummary'
      ),
      detail: this.i18n.t(
        nextEnable ? 'toastHealthyTrafficStartedDetail' : 'toastHealthyTrafficStoppedDetail'
      ),
      life: 4000
    });
  }

  /**
   * Triggers a simulated failure or replay sequence and surfaces status feedback via toast.
   */
  async onTriggerChaos(): Promise<void> {
    const result = await this.incidentService.triggerChaos();
    if (!result.ok) {
      this.notifyActionError(result);
      return;
    }
    this.messageService.add({
      severity: 'success',
      summary: this.i18n.t('toastChaosStartedSummary'),
      detail: this.i18n.t('toastChaosStartedDetail'),
      life: 4000
    });
  }

  /**
   * Resets target service chaos, refreshes dashboard state, and notifies via toast.
   */
  async onResetService(): Promise<void> {
    const result = await this.incidentService.resetChaos('', true);
    if (!result.ok) {
      this.notifyActionError(result);
      return;
    }
    this.messageService.add({
      severity: 'success',
      summary: this.i18n.t('toastServiceRestoredSummary'),
      detail: this.i18n.t('toastServiceRestoredDetail'),
      life: 4000
    });
  }

  /**
   * Triggers a simulated approval decision in demo mode, restores target health, and keeps incident visible.
   */
  async onSimulateDecision(): Promise<void> {
    const result = await this.incidentService.simulateDecision(DecisionAction.APPROVE);
    if (!result.ok) {
      this.notifyActionError(result);
      return;
    }

    const resetResult = await this.incidentService.resetChaos('', false);
    if (!resetResult.ok) {
      this.notifyActionError(resetResult);
      return;
    }

    this.messageService.add({
      severity: 'success',
      summary: this.i18n.t('toastDecisionApprovedSummary'),
      detail: this.i18n.t('toastDecisionApprovedDetail'),
      life: 5000
    });
  }
}

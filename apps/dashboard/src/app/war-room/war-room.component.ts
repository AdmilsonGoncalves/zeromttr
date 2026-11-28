import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { isNonEmptyString } from '@zeromttr/utils';
import { HTTP_STATUS } from '@zeromttr/utils/http';
import { MessageService } from 'primeng/api';
import { Toast } from 'primeng/toast';
import { DashboardApiErrorCode, ToastSeverity } from '../core/constants.js';
import {
  AlertSuppressionReason,
  type AlertSuppressedEvent,
  DecisionAction,
  IncidentExecutionMode,
  type IncidentLlmFailedEvent,
  TargetHealthStatus,
  type IncidentMode
} from '../core/contract.js';
import { I18nService, type Language } from '../core/i18n/i18n.service.js';
import { IncidentService, type DemoActionResult } from '../core/incident.service.js';
import { SystemSettingsService } from '../core/system-settings.service.js';
import { EvidencePanelComponent } from './evidence-panel/evidence-panel.component.js';
import { FsmTimelineComponent } from './fsm-timeline/fsm-timeline.component.js';
import { RemediationPanelComponent } from './remediation-panel/remediation-panel.component.js';
import { TargetTelemetryComponent } from './target-telemetry/target-telemetry.component.js';
import { WarRoomHeaderComponent } from './war-room-header/war-room-header.component.js';
import { WarRoomKpisComponent } from './war-room-kpis/war-room-kpis.component.js';
import { WarRoomNoticesComponent } from './war-room-notices/war-room-notices.component.js';

/**
 * Single-pane War Room mission control orchestrator composing decoupled header, notices, telemetry, and quadrant panels.
 */
@Component({
  selector: 'app-war-room',
  imports: [
    Toast,
    WarRoomHeaderComponent,
    WarRoomNoticesComponent,
    FsmTimelineComponent,
    TargetTelemetryComponent,
    WarRoomKpisComponent,
    EvidencePanelComponent,
    RemediationPanelComponent
  ],
  providers: [MessageService],
  templateUrl: './war-room.component.html',
  styleUrl: './war-room.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomComponent implements OnInit, OnDestroy {
  readonly i18n = inject(I18nService);
  readonly incidentService = inject(IncidentService);
  readonly settingsService = inject(SystemSettingsService, { optional: true });
  readonly messageService = inject(MessageService, { optional: true }) ?? new MessageService();

  private readonly unsubscribers: Array<() => void> = [];
  private suppressGrafanaWaitWarning = false;

  ngOnInit(): void {
    this.unsubscribers.push(
      this.incidentService.onAlertSuppressed((event) => this.notifyAlertSuppressed(event)),
      this.incidentService.onLlmFailed((event) => this.notifyLlmFailed(event)),
      this.incidentService.onLiveWaitExceeded((seconds) => this.notifyGrafanaRepeatWait(seconds))
    );
    this.incidentService.connectSse();
    void this.incidentService.fetchDemoConfig();
    void this.incidentService.fetchTargetStatus();
    if (this.settingsService && !this.settingsService.readonlyInfo()) {
      void this.settingsService.fetchSettings();
    }
    this.incidentService.startTargetStatusPolling();
    void this.incidentService.fetchIncidents();
  }

  ngOnDestroy(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.incidentService.stopTargetStatusPolling();
    this.incidentService.disconnectSse();
  }

  /**
   * Applies the selected execution mode and forces synthetic healthy traffic off when exiting Live mode.
   */
  onModeChange(mode: IncidentMode): void {
    if (!isNonEmptyString(mode)) {
      return;
    }
    this.incidentService.setActiveMode(mode);
    if (
      mode !== IncidentExecutionMode.LIVE &&
      (this.incidentService.targetMetrics()?.healthyTrafficActive ?? false) &&
      !this.incidentService.isTogglingTraffic()
    ) {
      void this.applyHealthyTrafficToggle(false);
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
    if (
      result.status === HTTP_STATUS.FORBIDDEN &&
      result.errorCode?.startsWith(DashboardApiErrorCode.TURNSTILE_PREFIX)
    ) {
      this.messageService.add({
        severity: ToastSeverity.ERROR,
        summary: this.i18n.t('toastTurnstileRequiredSummary'),
        detail: this.i18n.t('toastTurnstileRequiredDetail'),
        life: 6000
      });
      return;
    }

    if (result.status === HTTP_STATUS.FORBIDDEN) {
      this.messageService.add({
        severity: ToastSeverity.ERROR,
        summary: this.i18n.t('toastLiveKeyRequiredSummary'),
        detail: this.i18n.t('toastLiveKeyRequiredDetail'),
        life: 6000
      });
      return;
    }

    if (result.status === HTTP_STATUS.TOO_MANY_REQUESTS) {
      const isRateLimit = result.errorCode === DashboardApiErrorCode.RATE_LIMIT_EXCEEDED;
      const summaryKey = isRateLimit ? 'toastRateLimitSummary' : 'toastCooldownSummary';
      const detailWithSecondsKey = isRateLimit
        ? 'toastRateLimitDetailWithSeconds'
        : 'toastCooldownDetailWithSeconds';
      const detailKey = isRateLimit ? 'toastRateLimitDetail' : 'toastCooldownDetail';

      const detail =
        result.retryAfterSeconds !== undefined
          ? this.i18n.t(detailWithSecondsKey).replace('{N}', String(result.retryAfterSeconds))
          : this.i18n.t(detailKey);
      this.messageService.add({
        severity: ToastSeverity.WARN,
        summary: this.i18n.t(summaryKey),
        detail,
        life: 6000
      });
      return;
    }

    const fallbackDetail = result.status
      ? `${this.i18n.t('toastActionErrorDetail')} (HTTP ${result.status})`
      : this.i18n.t('toastActionErrorDetail');
    this.messageService.add({
      severity: ToastSeverity.ERROR,
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
    await this.applyHealthyTrafficToggle(nextEnable);
  }

  private async applyHealthyTrafficToggle(nextEnable: boolean): Promise<void> {
    const result = await this.incidentService.toggleHealthyTraffic(nextEnable);
    if (!result.ok) {
      this.notifyActionError(result);
      return;
    }

    if (nextEnable && this.incidentService.activeMode() !== IncidentExecutionMode.LIVE) {
      await this.applyHealthyTrafficToggle(false);
      return;
    }

    const detailKey = nextEnable
      ? 'toastHealthyTrafficStartedDetail'
      : 'toastHealthyTrafficStoppedDetail';
    const service = this.incidentService.targetServiceName() || this.i18n.t('serviceStatusLabel');
    this.messageService.add({
      severity: ToastSeverity.INFO,
      summary: this.i18n.t(
        nextEnable ? 'toastHealthyTrafficStartedSummary' : 'toastHealthyTrafficStoppedSummary'
      ),
      detail: this.i18n.t(detailKey, { service }),
      life: 4000
    });
  }

  private formatDurationSeconds(seconds: number): string {
    const normalized = Math.max(0, Math.round(seconds));
    if (normalized < 60) {
      return `${normalized}s`;
    }
    const mins = Math.floor(normalized / 60);
    const rem = normalized % 60;
    if (rem === 0) {
      return `${mins}m`;
    }
    return `${mins}m ${rem}s`;
  }

  private resolveGrafanaRepeatIntervalLabel(): string {
    const configured = this.settingsService?.readonlyInfo()?.grafanaRepeatInterval;
    if (isNonEmptyString(configured)) {
      return configured;
    }
    return this.i18n.t('grafanaRepeatIntervalFallback');
  }

  private notifyAlertSuppressed(event: AlertSuppressedEvent): void {
    const isRejection = event.reason === AlertSuppressionReason.REJECTION_COOLDOWN;
    const summaryKey = isRejection
      ? 'toastAlertSuppressedRejectionSummary'
      : 'toastAlertSuppressedRepeatSummary';
    const detailKey = isRejection
      ? 'toastAlertSuppressedRejectionDetail'
      : 'toastAlertSuppressedRepeatDetail';

    this.messageService.add({
      severity: ToastSeverity.WARN,
      summary: this.i18n.t(summaryKey),
      detail: this.i18n.t(detailKey, {
        service: event.service || this.i18n.t('serviceStatusLabel'),
        remaining: this.formatDurationSeconds(event.remainingSeconds),
        window: this.formatDurationSeconds(event.windowSeconds)
      }),
      life: 10000
    });
  }

  private notifyLlmFailed(event: IncidentLlmFailedEvent): void {
    const summaryKey = event.fallbackUsed
      ? 'toastLlmFailedFallbackSummary'
      : 'toastLlmFailedSummary';
    const detailKey = event.fallbackUsed ? 'toastLlmFailedFallbackDetail' : 'toastLlmFailedDetail';

    this.messageService.add({
      severity: event.fallbackUsed ? ToastSeverity.WARN : ToastSeverity.ERROR,
      summary: this.i18n.t(summaryKey),
      detail: this.i18n.t(detailKey, {
        service: event.service || this.i18n.t('serviceStatusLabel'),
        error: event.error
      }),
      life: 12000
    });
  }

  private notifyGrafanaRepeatWait(seconds: number): void {
    if (this.suppressGrafanaWaitWarning) {
      return;
    }
    this.messageService.add({
      severity: ToastSeverity.WARN,
      summary: this.i18n.t('toastGrafanaRepeatWaitSummary', { seconds: String(seconds) }),
      detail: this.i18n.t('toastGrafanaRepeatWaitDetail', {
        interval: this.resolveGrafanaRepeatIntervalLabel()
      }),
      life: 12000
    });
  }

  /**
   * Triggers a simulated failure or replay sequence and surfaces status feedback via toast.
   */
  async onTriggerChaos(): Promise<void> {
    const wasAlreadyDegraded =
      this.incidentService.activeMode() === IncidentExecutionMode.LIVE &&
      this.incidentService.targetStatus()?.status === TargetHealthStatus.DEGRADED;
    this.suppressGrafanaWaitWarning = false;

    const result = await this.incidentService.triggerChaos();
    if (!result.ok) {
      this.notifyActionError(result);
      return;
    }
    if (wasAlreadyDegraded) {
      this.suppressGrafanaWaitWarning = true;
      this.messageService.add({
        severity: ToastSeverity.WARN,
        summary: this.i18n.t('toastGrafanaRepeatAlreadyDegradedSummary'),
        detail: this.i18n.t('toastGrafanaRepeatAlreadyDegradedDetail', {
          interval: this.resolveGrafanaRepeatIntervalLabel()
        }),
        life: 12000
      });
      return;
    }
    this.messageService.add({
      severity: ToastSeverity.SUCCESS,
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
      severity: ToastSeverity.SUCCESS,
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

    this.messageService.add({
      severity: ToastSeverity.SUCCESS,
      summary: this.i18n.t('toastDecisionApprovedSummary'),
      detail: this.i18n.t('toastDecisionApprovedDetail'),
      life: 5000
    });
  }
}

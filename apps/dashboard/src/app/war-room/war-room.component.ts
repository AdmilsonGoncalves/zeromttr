import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
  escapeHtml,
  isFilled,
  isNonEmptyString,
  isObject,
  isString,
  safeJsonParse
} from '@zeromttr/utils';
import { MessageService } from 'primeng/api';
import { SelectButton } from 'primeng/selectbutton';
import { Tag } from 'primeng/tag';
import { Button } from 'primeng/button';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'primeng/tabs';
import { ProgressBar } from 'primeng/progressbar';
import { Toast } from 'primeng/toast';
import { Tooltip } from 'primeng/tooltip';
import { I18nService, type Language } from '../core/i18n.service.js';
import type { IncidentMode } from '../core/contract.js';
import { IncidentService, type DemoActionResult } from '../core/incident.service.js';
import { MASKED_POST_OTTL_LOG, MOCK_GIT_DIFF, RAW_PRE_COLLECTOR_LOG } from '../core/constants.js';

interface ModeOption {
  label: string;
  value: IncidentMode;
}

interface LangOption {
  label: string;
  value: Language;
}

/**
 * Single-pane War Room mission control component displaying live telemetry, PII audit, diffs, and FinOps.
 */
@Component({
  selector: 'app-war-room',
  imports: [
    CommonModule,
    FormsModule,
    SelectButton,
    Tag,
    Button,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    ProgressBar,
    Toast,
    Tooltip
  ],
  providers: [MessageService],
  templateUrl: './war-room.component.html',
  styleUrl: './war-room.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomComponent implements OnInit, OnDestroy {
  readonly i18n: I18nService;
  readonly incidentService: IncidentService;
  readonly sanitizer: DomSanitizer;
  readonly messageService: MessageService;

  readonly activeTab = signal<string>('0');
  readonly mockGitDiff = MOCK_GIT_DIFF;
  readonly rawPreCollectorLog = RAW_PRE_COLLECTOR_LOG;
  readonly maskedPostOttlLog = MASKED_POST_OTTL_LOG;

  readonly displayedPreCollectorLog = computed<string>(() => {
    return (
      this.incidentService.currentIncident()?.rca?.rawEdgeLogPreCollector ??
      this.incidentService.targetStatus()?.rawEdgeLogPreCollector ??
      this.rawPreCollectorLog
    );
  });

  readonly displayedPostOttlLog = computed<string>(() => {
    if (this.incidentService.isPiiPassed() === false) {
      const types = (
        this.incidentService.currentIncident()?.rca?.piiGuardAudit?.detectedTypes ?? []
      ).join(', ');
      return this.i18n.t('piiLogWithheldMessage').replace('{TYPES}', types);
    }

    const sample = this.incidentService.currentIncident()?.rca?.logSample;
    if (!isNonEmptyString(sample)) {
      return this.maskedPostOttlLog;
    }

    const lines = sample
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const parsed = safeJsonParse<Record<string, unknown>>(line);
      if (isObject(parsed) && isNonEmptyString(parsed.body)) {
        return parsed.body;
      }
      const bodyMatch = line.match(/^\{"body":"((?:[^"\\]|\\.)*)"/);
      if (bodyMatch?.[1]) {
        return bodyMatch[1].replace(/\\"/g, '"');
      }
    }

    return lines[0] ?? this.maskedPostOttlLog;
  });

  /**
   * Updates the selected dashboard tab signal when a valid tab value is provided.
   */
  onTabChange(tab: string | number | undefined): void {
    if (isFilled(tab)) {
      this.activeTab.set(String(tab));
    }
  }

  readonly safeResendPreview = computed<SafeHtml>(() => {
    const incident = this.incidentService.currentIncident();
    const notification = incident?.notification;
    const raw = notification?.htmlPreview;

    if (
      notification?.status === 'degraded' ||
      (isNonEmptyString(raw) && raw.startsWith('Warning: Resend delivery failed'))
    ) {
      const degradedHtml = `
      <div style="font-family: sans-serif; color: #fde68a;">
        <h3 style="color: #fbbf24; margin-top: 0; font-size: 12px;">${this.i18n.t('resendDegradedTitle')}</h3>
        <p style="font-size: 11px; color: #cbd5e1; margin-bottom: 6px;">${this.i18n.t('resendDegradedBody')}</p>
      </div>
    `;
      return this.sanitizer.bypassSecurityTrustHtml(degradedHtml);
    }

    if (
      notification?.status === 'dispatched' &&
      (!isNonEmptyString(raw) || !raw.trim().startsWith('<'))
    ) {
      const dispatchedHtml = `
      <div style="font-family: sans-serif; color: #cbd5e1;">
        <h3 style="color: #34d399; margin-top: 0; font-size: 12px;">✅ ${this.i18n.t('resendDispatchedBadge')}</h3>
        <p style="font-size: 11px; margin-bottom: 4px;">${this.i18n.t('resendDispatchedBody')}</p>
        <p style="font-size: 10px; color: #94a3b8; font-family: monospace;">ID: ${escapeHtml(notification.emailId ?? '')}</p>
      </div>
    `;
      return this.sanitizer.bypassSecurityTrustHtml(dispatchedHtml);
    }

    const defaultPreview = `
    <div style="font-family: sans-serif; color: #cbd5e1;">
      <h3 style="color: #ef4444; margin-top: 0;">🚨 ZeroMTTR Incident Post-Mortem</h3>
      <p style="font-size: 11px;">${this.i18n.t('resendDefaultBody')}</p>
    </div>
  `;
    return this.sanitizer.bypassSecurityTrustHtml(raw ?? defaultPreview);
  });

  readonly modeOptions: ModeOption[] = [
    { label: '⚡ Live API Mode', value: 'live' },
    { label: '🎬 Replay Mode', value: 'replay' }
  ];

  readonly langOptions: LangOption[] = [
    { label: '🇧🇷 PT', value: 'pt' },
    { label: '🇺🇸 EN', value: 'en' }
  ];

  constructor(...args: [I18nService?, IncidentService?, DomSanitizer?, MessageService?]) {
    const [i18n, incidentService, sanitizer, messageService] = args;
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
    if (sanitizer) {
      this.sanitizer = sanitizer;
    } else {
      try {
        this.sanitizer =
          inject(DomSanitizer, { optional: true }) ??
          ({
            bypassSecurityTrustHtml: (html: string) => html as unknown as SafeHtml
          } as DomSanitizer);
      } catch {
        this.sanitizer = {
          bypassSecurityTrustHtml: (html: string) => html as unknown as SafeHtml
        } as DomSanitizer;
      }
    }
  }

  ngOnInit(): void {
    this.incidentService.connectSse();
    void this.incidentService.fetchTargetStatus();
    void this.incidentService.fetchIncidents();
  }

  ngOnDestroy(): void {
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
   * Captures the live demo key from the input element and stores it in the service.
   */
  onLiveKeyInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target && isString(target.value)) {
      this.incidentService.setLiveDemoKey(target.value);
    }
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
    const result = await this.incidentService.simulateDecision('approve');
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

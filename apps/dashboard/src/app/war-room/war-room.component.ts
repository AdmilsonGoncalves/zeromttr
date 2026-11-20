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
import { isFilled, isNonEmptyString, isString } from '@zeromttr/utils';
import { SelectButton } from 'primeng/selectbutton';
import { Tag } from 'primeng/tag';
import { Button } from 'primeng/button';
import { Timeline } from 'primeng/timeline';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'primeng/tabs';
import { ProgressBar } from 'primeng/progressbar';
import { I18nService, type Language } from '../core/i18n.service.js';
import type { IncidentMode } from '../core/contract.js';
import { IncidentService } from '../core/incident.service.js';
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
    Timeline,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    ProgressBar
  ],
  templateUrl: './war-room.component.html',
  styleUrl: './war-room.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomComponent implements OnInit, OnDestroy {
  readonly i18n: I18nService;
  readonly incidentService: IncidentService;
  readonly sanitizer: DomSanitizer;

  readonly activeTab = signal<string>('0');
  readonly mockGitDiff = MOCK_GIT_DIFF;
  readonly rawPreCollectorLog = RAW_PRE_COLLECTOR_LOG;
  readonly maskedPostOttlLog = MASKED_POST_OTTL_LOG;

  /**
   * Updates the selected dashboard tab signal when a valid tab value is provided.
   */
  onTabChange(tab: string | number | undefined): void {
    if (isFilled(tab)) {
      this.activeTab.set(String(tab));
    }
  }

  readonly safeResendPreview = computed<SafeHtml>(() => {
    const defaultPreview = `
    <div style="font-family: sans-serif; color: #cbd5e1;">
      <h3 style="color: #ef4444; margin-top: 0;">🚨 ZeroMTTR Incident Post-Mortem</h3>
      <p style="font-size: 11px;">${this.i18n.t('resendDefaultBody')}</p>
    </div>
  `;
    const raw = this.incidentService.currentIncident()?.notification?.htmlPreview ?? defaultPreview;
    return this.sanitizer.bypassSecurityTrustHtml(raw);
  });

  readonly modeOptions: ModeOption[] = [
    { label: '⚡ Live API Mode', value: 'live' },
    { label: '🎬 Replay Mode', value: 'replay' }
  ];

  readonly langOptions: LangOption[] = [
    { label: '🇧🇷 PT', value: 'pt' },
    { label: '🇺🇸 EN', value: 'en' }
  ];

  constructor(...args: [I18nService?, IncidentService?, DomSanitizer?]) {
    const [i18n, incidentService, sanitizer] = args;
    this.i18n = i18n ?? inject(I18nService);
    this.incidentService = incidentService ?? inject(IncidentService);
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

  /**
   * Triggers a simulated failure or replay sequence.
   */
  onTriggerChaos(): void {
    void this.incidentService.triggerChaos();
  }

  /**
   * Resets target service chaos and refreshes dashboard state.
   */
  onResetService(): void {
    void this.incidentService.resetChaos();
  }

  /**
   * Triggers a simulated approval decision in demo mode.
   */
  onSimulateDecision(): void {
    void this.incidentService.simulateDecision('approve');
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { isNonEmptyString, isString } from '@zeromttr/utils';
import { Toolbar } from 'primeng/toolbar';
import { SelectButton } from 'primeng/selectbutton';
import { Tag } from 'primeng/tag';
import { Button } from 'primeng/button';
import { Timeline } from 'primeng/timeline';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'primeng/tabs';
import { ProgressBar } from 'primeng/progressbar';
import { Card } from 'primeng/card';
import {
  I18nService,
  type IncidentMode,
  IncidentService,
  type Language,
  MASKED_POST_OTTL_LOG,
  MOCK_GIT_DIFF,
  RAW_PRE_COLLECTOR_LOG
} from '../core/index.js';

interface ModeOption {
  label: string;
  value: IncidentMode;
}

interface LangOption {
  label: string;
  value: Language;
}

@Component({
  selector: 'app-war-room',
  imports: [
    CommonModule,
    FormsModule,
    Toolbar,
    SelectButton,
    Tag,
    Button,
    Timeline,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    ProgressBar,
    Card
  ],
  templateUrl: './war-room.component.html',
  styleUrl: './war-room.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomComponent implements OnInit, OnDestroy {
  readonly i18n: I18nService;
  readonly incidentService: IncidentService;

  readonly activeTab = signal<string>('0');
  readonly mockGitDiff = MOCK_GIT_DIFF;
  readonly rawPreCollectorLog = RAW_PRE_COLLECTOR_LOG;
  readonly maskedPostOttlLog = MASKED_POST_OTTL_LOG;

  onTabChange(tab: string | number | undefined): void {
    if (tab !== undefined && tab !== null) {
      this.activeTab.set(String(tab));
    }
  }

  readonly defaultResendPreview = `
    <div style="font-family: sans-serif; color: #cbd5e1;">
      <h3 style="color: #ef4444; margin-top: 0;">🚨 ZeroMTTR Incident Post-Mortem</h3>
      <p style="font-size: 11px;">Aguardando aprovação do plantonista via link seguro exclusivo.</p>
    </div>
  `;

  readonly modeOptions: ModeOption[] = [
    { label: '⚡ Live API Mode', value: 'live' },
    { label: '🎬 Replay Mode', value: 'replay' }
  ];

  readonly langOptions: LangOption[] = [
    { label: '🇧🇷 PT', value: 'pt' },
    { label: '🇺🇸 EN', value: 'en' }
  ];

  constructor(...args: [I18nService?, IncidentService?]) {
    const [i18n, incidentService] = args;
    this.i18n = i18n ?? inject(I18nService);
    this.incidentService = incidentService ?? inject(IncidentService);
  }

  ngOnInit(): void {
    this.incidentService.connectSse();
    void this.incidentService.fetchTargetStatus();
    void this.incidentService.fetchIncidents();
  }

  ngOnDestroy(): void {
    this.incidentService.disconnectSse();
  }

  onModeChange(mode: IncidentMode): void {
    if (isNonEmptyString(mode)) {
      this.incidentService.setActiveMode(mode);
    }
  }

  onLiveKeyInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target && isString(target.value)) {
      this.incidentService.setLiveDemoKey(target.value);
    }
  }

  onLangChange(lang: Language): void {
    if (isNonEmptyString(lang)) {
      this.i18n.setLang(lang);
    }
  }

  onTriggerChaos(): void {
    void this.incidentService.triggerChaos();
  }

  onResetService(): void {
    void this.incidentService.resetChaos();
  }

  onSimulateDecision(): void {
    void this.incidentService.simulateDecision('approve');
  }
}

import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { isNonEmptyString, isString } from '@zeromttr/utils';
import { Button } from 'primeng/button';
import { SelectButton } from 'primeng/selectbutton';
import { Tag } from 'primeng/tag';
import { Tooltip } from 'primeng/tooltip';
import {
  IncidentExecutionMode,
  type IncidentMode,
  type ReasoningSource,
  type TargetStatusResponse
} from '../../core/contract.js';
import { I18nService, type Language } from '../../core/i18n.service.js';

interface ModeOption {
  label: string;
  value: IncidentMode;
}

interface LangOption {
  label: string;
  value: Language;
}

/**
 * Top War Room header containing service status tags, FinOps badge, execution controls, and KPI strip.
 */
@Component({
  selector: 'app-war-room-header',
  imports: [FormsModule, SelectButton, Tag, Button, Tooltip],
  templateUrl: './war-room-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomHeaderComponent {
  readonly i18n: I18nService;

  readonly sseConnected = input.required<boolean>();
  readonly targetStatus = input<TargetStatusResponse | null>(null);
  readonly finopsReduction = input.required<number>();
  readonly estimatedTokensSaved = input.required<number>();
  readonly activeMode = input.required<IncidentMode>();
  readonly isWorkflowRunning = input.required<boolean>();
  readonly liveDemoKey = input.required<string>();
  readonly healthyTrafficActive = input<boolean>(false);
  readonly isTogglingTraffic = input.required<boolean>();
  readonly isResetting = input.required<boolean>();
  readonly isSimulating = input.required<boolean>();
  readonly ttdDisplay = input.required<string>();
  readonly ttprDisplay = input.required<string>();
  readonly signalsRatio = input.required<string>();
  readonly evidenceCoveragePercent = input.required<number>();
  readonly reasoningSource = input<ReasoningSource | null>(null);

  readonly modeChange = output<IncidentMode>();
  readonly liveKeyChange = output<string>();
  readonly langChange = output<Language>();
  readonly toggleHealthyTraffic = output<void>();
  readonly triggerChaos = output<void>();
  readonly resetService = output<void>();

  readonly modeOptions: ModeOption[] = [
    { label: '⚡ Live API Mode', value: IncidentExecutionMode.LIVE },
    { label: '🎬 Replay Mode', value: IncidentExecutionMode.REPLAY }
  ];

  readonly langOptions: LangOption[] = [
    { label: '🇧🇷 PT', value: 'pt' },
    { label: '🇺🇸 EN', value: 'en' }
  ];

  constructor(i18n?: I18nService) {
    this.i18n = i18n ?? inject(I18nService);
  }

  /**
   * Emits the newly selected execution mode when valid.
   */
  onModeSelect(mode: IncidentMode): void {
    if (isNonEmptyString(mode)) {
      this.modeChange.emit(mode);
    }
  }

  /**
   * Emits the updated live demo key from the password input.
   */
  onLiveKeyInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target && isString(target.value)) {
      this.liveKeyChange.emit(target.value);
    }
  }

  /**
   * Emits the selected UI language when valid.
   */
  onLangSelect(lang: Language): void {
    if (isNonEmptyString(lang)) {
      this.langChange.emit(lang);
    }
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal
} from '@angular/core';
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

  readonly sseConnectedSignal = signal<boolean>(false);
  readonly targetStatusSignal = signal<TargetStatusResponse | null>(null);
  readonly finopsReductionSignal = signal<number>(0);
  readonly estimatedTokensSavedSignal = signal<number>(0);
  readonly activeModeSignal = signal<IncidentMode>(IncidentExecutionMode.REPLAY);
  readonly isWorkflowRunningSignal = signal<boolean>(false);
  readonly liveDemoKeySignal = signal<string>('');
  readonly healthyTrafficActiveSignal = signal<boolean>(false);
  readonly isTogglingTrafficSignal = signal<boolean>(false);
  readonly isResettingSignal = signal<boolean>(false);
  readonly isSimulatingSignal = signal<boolean>(false);
  readonly ttdDisplaySignal = signal<string>('--');
  readonly ttprDisplaySignal = signal<string>('--');
  readonly signalsRatioSignal = signal<string>('0/4');
  readonly evidenceCoveragePercentSignal = signal<number>(0);
  readonly reasoningSourceSignal = signal<ReasoningSource | null>(null);

  @Input({ required: true })
  set sseConnected(value: boolean) {
    this.sseConnectedSignal.set(value);
  }

  @Input()
  set targetStatus(value: TargetStatusResponse | null) {
    this.targetStatusSignal.set(value);
  }

  @Input({ required: true })
  set finopsReduction(value: number) {
    this.finopsReductionSignal.set(value);
  }

  @Input({ required: true })
  set estimatedTokensSaved(value: number) {
    this.estimatedTokensSavedSignal.set(value);
  }

  @Input({ required: true })
  set activeMode(value: IncidentMode) {
    this.activeModeSignal.set(value);
  }

  @Input({ required: true })
  set isWorkflowRunning(value: boolean) {
    this.isWorkflowRunningSignal.set(value);
  }

  @Input({ required: true })
  set liveDemoKey(value: string) {
    this.liveDemoKeySignal.set(value);
  }

  @Input()
  set healthyTrafficActive(value: boolean) {
    this.healthyTrafficActiveSignal.set(value);
  }

  @Input({ required: true })
  set isTogglingTraffic(value: boolean) {
    this.isTogglingTrafficSignal.set(value);
  }

  @Input({ required: true })
  set isResetting(value: boolean) {
    this.isResettingSignal.set(value);
  }

  @Input({ required: true })
  set isSimulating(value: boolean) {
    this.isSimulatingSignal.set(value);
  }

  @Input({ required: true })
  set ttdDisplay(value: string) {
    this.ttdDisplaySignal.set(value);
  }

  @Input({ required: true })
  set ttprDisplay(value: string) {
    this.ttprDisplaySignal.set(value);
  }

  @Input({ required: true })
  set signalsRatio(value: string) {
    this.signalsRatioSignal.set(value);
  }

  @Input({ required: true })
  set evidenceCoveragePercent(value: number) {
    this.evidenceCoveragePercentSignal.set(value);
  }

  @Input()
  set reasoningSource(value: ReasoningSource | null) {
    this.reasoningSourceSignal.set(value);
  }

  @Output() readonly modeChange = new EventEmitter<IncidentMode>();
  @Output() readonly liveKeyChange = new EventEmitter<string>();
  @Output() readonly langChange = new EventEmitter<Language>();
  @Output() readonly toggleHealthyTraffic = new EventEmitter<void>();
  @Output() readonly triggerChaos = new EventEmitter<void>();
  @Output() readonly resetService = new EventEmitter<void>();

  readonly modeOptions: ModeOption[] = [
    { label: '⚡ Live API Mode', value: IncidentExecutionMode.LIVE },
    { label: '🎬 Replay Mode', value: IncidentExecutionMode.REPLAY }
  ];

  readonly langOptions: LangOption[] = [
    { label: '🇧🇷 PT', value: 'pt' },
    { label: '🇺🇸 EN', value: 'en' }
  ];

  constructor(...args: [I18nService?]) {
    const [i18n] = args;
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

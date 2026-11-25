import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
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
  TargetHealthStatus,
  type IncidentMode,
  type TargetStatusResponse
} from '../../core/contract.js';
import { I18nService, type Language } from '../../core/i18n/i18n.service.js';
import { LocaleSwitcherComponent } from '../locale-switcher/locale-switcher.component.js';

interface ModeOption {
  label: string;
  value: IncidentMode;
}

/**
 * Pure top War Room header displaying project identity, target connection tags, command actions, and locale switcher.
 */
@Component({
  selector: 'app-war-room-header',
  imports: [NgClass, FormsModule, SelectButton, Tag, Button, Tooltip, LocaleSwitcherComponent],
  templateUrl: './war-room-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomHeaderComponent {
  readonly i18n: I18nService;

  readonly sseConnectedSignal = signal<boolean>(false);
  readonly targetStatusSignal = signal<TargetStatusResponse | null>(null);
  readonly activeModeSignal = signal<IncidentMode>(IncidentExecutionMode.REPLAY);
  readonly isWorkflowRunningSignal = signal<boolean>(false);
  readonly liveDemoKeySignal = signal<string>('');
  readonly publicLiveDemoSignal = signal<boolean>(false);
  readonly simulationLockedByTurnstileSignal = signal<boolean>(false);
  readonly healthyTrafficActiveSignal = signal<boolean>(false);
  readonly isTogglingTrafficSignal = signal<boolean>(false);
  readonly isResettingSignal = signal<boolean>(false);
  readonly isSimulatingSignal = signal<boolean>(false);
  readonly isMobileMenuOpenSignal = signal<boolean>(false);
  readonly isHealthyTrafficStartBlockedSignal = computed<boolean>(
    () =>
      !this.healthyTrafficActiveSignal() &&
      this.targetStatusSignal()?.status === TargetHealthStatus.DEGRADED
  );

  @Input({ required: true })
  set sseConnected(value: boolean) {
    this.sseConnectedSignal.set(value);
  }

  @Input()
  set targetStatus(value: TargetStatusResponse | null) {
    this.targetStatusSignal.set(value);
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
  set publicLiveDemo(value: boolean) {
    this.publicLiveDemoSignal.set(value);
  }

  @Input()
  set simulationLockedByTurnstile(value: boolean) {
    this.simulationLockedByTurnstileSignal.set(value);
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

  constructor(...args: [I18nService?]) {
    const [i18n] = args;
    this.i18n = i18n ?? inject(I18nService);
  }

  /**
   * Toggles the collapsible header command menu on narrow screens.
   */
  toggleMobileMenu(): void {
    this.isMobileMenuOpenSignal.update((open) => !open);
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

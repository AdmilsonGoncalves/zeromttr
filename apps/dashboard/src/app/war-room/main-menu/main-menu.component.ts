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
import { Tooltip } from 'primeng/tooltip';
import {
  IncidentExecutionMode,
  TargetHealthStatus,
  type IncidentMode,
  type TargetStatusResponse
} from '../../core/contract.js';
import { I18nService } from '../../core/i18n/i18n.service.js';

interface ModeOption {
  label: string;
  value: IncidentMode;
}

/**
 * Modular command menu isolating interactive demo controls (mode switch, live key, traffic, chaos, reset).
 * Hidden automatically when `demoModeEnabled` is false for production/real-use deployments.
 */
@Component({
  selector: 'app-main-menu',
  imports: [FormsModule, SelectButton, Button, Tooltip],
  templateUrl: './main-menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MainMenuComponent {
  readonly i18n: I18nService;
  readonly executionMode = IncidentExecutionMode;

  readonly demoModeEnabledSignal = signal<boolean>(true);
  readonly targetStatusSignal = signal<TargetStatusResponse | null>(null);
  readonly activeModeSignal = signal<IncidentMode>(IncidentExecutionMode.REPLAY);
  readonly isWorkflowRunningSignal = signal<boolean>(false);
  readonly liveDemoKeySignal = signal<string>('');
  readonly requireDemoKeySignal = signal<boolean>(true);
  readonly simulationLockedByTurnstileSignal = signal<boolean>(false);
  readonly healthyTrafficActiveSignal = signal<boolean>(false);
  readonly isTogglingTrafficSignal = signal<boolean>(false);
  readonly isResettingSignal = signal<boolean>(false);
  readonly isSimulatingSignal = signal<boolean>(false);

  readonly isHealthyTrafficStartBlockedSignal = computed<boolean>(
    () =>
      !this.healthyTrafficActiveSignal() &&
      this.targetStatusSignal()?.status === TargetHealthStatus.DEGRADED
  );
  readonly canSimulateChaos = computed<boolean>(() => {
    if (!this.demoModeEnabledSignal()) {
      return false;
    }
    if (this.activeModeSignal() === IncidentExecutionMode.REPLAY) {
      return true;
    }
    return this.targetStatusSignal()?.capabilities?.chaosSimulation ?? false;
  });
  readonly canToggleHealthyTraffic = computed<boolean>(() => {
    if (!this.demoModeEnabledSignal() || this.activeModeSignal() !== IncidentExecutionMode.LIVE) {
      return false;
    }
    return this.targetStatusSignal()?.capabilities?.healthyTrafficToggle ?? false;
  });

  @Input()
  set demoModeEnabled(value: boolean) {
    this.demoModeEnabledSignal.set(value);
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
  set requireDemoKey(value: boolean) {
    this.requireDemoKeySignal.set(value);
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
  @Output() readonly toggleHealthyTraffic = new EventEmitter<void>();
  @Output() readonly triggerChaos = new EventEmitter<void>();
  @Output() readonly resetService = new EventEmitter<void>();

  readonly modeOptions = computed<ModeOption[]>(() => [
    { label: this.i18n.t('liveMode'), value: IncidentExecutionMode.LIVE },
    { label: this.i18n.t('replayMode'), value: IncidentExecutionMode.REPLAY }
  ]);

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
}

import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule, type NgModel } from '@angular/forms';
import { isNonEmptyString, isString } from '@zeromttr/utils';
import { Button } from 'primeng/button';
import { Drawer } from 'primeng/drawer';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { Tooltip } from 'primeng/tooltip';
import {
  IncidentExecutionMode,
  TargetHealthStatus,
  type IncidentMode,
  type TargetStatusResponse
} from '../../core/contract.js';
import { I18nService } from '../../core/i18n/i18n.service.js';

/**
 * Modular demo menu trigger and slide-over Drawer isolating interactive simulation controls
 * (Live/Replay toggle, Live API key, healthy traffic toggle, chaos trigger, and service reset).
 * Hidden automatically when `demoModeEnabled` is false for production deployments.
 */
@Component({
  selector: 'app-demo-settings',
  imports: [FormsModule, Drawer, ToggleSwitch, Button, Tooltip],
  templateUrl: './demo-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DemoSettingsComponent {
  readonly i18n = inject(I18nService);
  readonly executionMode = IncidentExecutionMode;

  readonly isDrawerOpenSignal = signal<boolean>(false);
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

  readonly isLiveMode = computed<boolean>(
    () => this.activeModeSignal() === IncidentExecutionMode.LIVE
  );

  readonly isLiveKeyInputDisabled = computed<boolean>(
    () => !this.requireDemoKeySignal() || !this.isLiveMode() || this.isWorkflowRunningSignal()
  );

  readonly displayedLiveDemoKey = computed<string>(() =>
    this.requireDemoKeySignal() ? this.liveDemoKeySignal() : ''
  );

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
    if (!this.demoModeEnabledSignal()) {
      return false;
    }
    const capabilitySupported =
      this.targetStatusSignal()?.capabilities?.healthyTrafficToggle ?? false;
    if (!capabilitySupported) {
      return false;
    }
    return (
      this.activeModeSignal() === IncidentExecutionMode.LIVE || this.healthyTrafficActiveSignal()
    );
  });

  readonly showHealthyTrafficControl = computed<boolean>(() => {
    if (!this.demoModeEnabledSignal()) {
      return false;
    }
    return this.targetStatusSignal()?.capabilities?.healthyTrafficToggle !== false;
  });

  readonly isHealthyTrafficToggleDisabled = computed<boolean>(
    () =>
      !this.canToggleHealthyTraffic() ||
      this.isTogglingTrafficSignal() ||
      this.simulationLockedByTurnstileSignal() ||
      this.isHealthyTrafficStartBlockedSignal()
  );

  readonly healthyTrafficHint = computed<string>(() => {
    if (this.simulationLockedByTurnstileSignal()) {
      return this.i18n.t('tooltipTurnstilePending');
    }
    if (!this.isLiveMode()) {
      return this.i18n.t('demoMenuTrafficReplayHint');
    }
    if (this.isHealthyTrafficStartBlockedSignal()) {
      return this.i18n.t('tooltipHealthyTrafficRequiresRestore');
    }
    return this.i18n.t('tooltipHealthyTraffic', {
      service: this.targetStatusSignal()?.service || this.i18n.t('serviceStatusLabel')
    });
  });

  readonly liveKeyHint = computed<string>(() => {
    if (!this.requireDemoKeySignal()) {
      return this.i18n.t('demoMenuKeyNotRequiredHint');
    }
    if (!this.isLiveMode()) {
      return this.i18n.t('demoMenuKeyReplayHint');
    }
    return this.i18n.t('demoMenuKeySavedHint');
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

  @ViewChild('healthyTrafficModel') healthyTrafficModel?: NgModel;

  @Input({ required: true })
  set isTogglingTraffic(value: boolean) {
    const wasToggling = this.isTogglingTrafficSignal();
    this.isTogglingTrafficSignal.set(value);
    if (wasToggling && !value) {
      this.syncHealthyTrafficSwitchControl();
    }
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

  /**
   * Opens the demo controls drawer.
   */
  openDrawer(): void {
    this.isDrawerOpenSignal.set(true);
  }

  /**
   * Closes the demo controls drawer.
   */
  closeDrawer(): void {
    this.isDrawerOpenSignal.set(false);
  }

  /**
   * Synchronizes the drawer open signal with PrimeNG Drawer two-way visibility events.
   */
  onDrawerVisibilityChange(visible: boolean): void {
    this.isDrawerOpenSignal.set(visible);
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
   * Translates the boolean Live toggle state into `LIVE` or `REPLAY` mode emissions.
   */
  onLiveModeToggle(enabled: boolean): void {
    if (this.isWorkflowRunningSignal()) {
      return;
    }
    this.onModeSelect(enabled ? IncidentExecutionMode.LIVE : IncidentExecutionMode.REPLAY);
  }

  /**
   * Emits the updated live demo key from the password input when required by server config.
   */
  onLiveKeyInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target && isString(target.value)) {
      this.liveKeyChange.emit(target.value);
    }
  }

  /**
   * Emits a healthy traffic toggle request only when the switch is enabled and state changes.
   */
  onHealthyTrafficToggle(enabled: boolean): void {
    if (this.isHealthyTrafficToggleDisabled() || enabled === this.healthyTrafficActiveSignal()) {
      this.syncHealthyTrafficSwitchControl();
      return;
    }
    this.toggleHealthyTraffic.emit();
  }

  private syncHealthyTrafficSwitchControl(): void {
    this.healthyTrafficModel?.control.setValue(this.healthyTrafficActiveSignal(), {
      emitEvent: false
    });
  }

  /**
   * Triggers chaos simulation and closes the drawer so the operator sees live War Room updates.
   */
  onTriggerChaos(): void {
    this.triggerChaos.emit();
    this.closeDrawer();
  }

  /**
   * Resets target service health and closes the drawer.
   */
  onResetService(): void {
    this.resetService.emit();
    this.closeDrawer();
  }
}

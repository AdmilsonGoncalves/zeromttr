import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal
} from '@angular/core';
import { isNonEmptyString } from '@zeromttr/utils';
import { Tag } from 'primeng/tag';
import {
  IncidentExecutionMode,
  TargetHealthStatus,
  type IncidentMode,
  type TargetStatusResponse
} from '../../core/contract.js';
import { I18nService, type Language } from '../../core/i18n/i18n.service.js';
import { LocaleSwitcherComponent } from '../locale-switcher/locale-switcher.component.js';
import { MainMenuComponent } from '../main-menu/main-menu.component.js';

/**
 * Pure top War Room header displaying project identity, target connection tags, modular main menu, and locale switcher.
 */
@Component({
  selector: 'app-war-room-header',
  imports: [NgClass, Tag, MainMenuComponent, LocaleSwitcherComponent],
  templateUrl: './war-room-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomHeaderComponent {
  readonly i18n: I18nService;
  readonly healthStatus = TargetHealthStatus;

  readonly demoModeEnabledSignal = signal<boolean>(false);
  readonly sseConnectedSignal = signal<boolean>(false);
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
  readonly isMobileMenuOpenSignal = signal<boolean>(false);

  @Input()
  set demoModeEnabled(value: boolean) {
    this.demoModeEnabledSignal.set(value);
  }

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
  @Output() readonly langChange = new EventEmitter<Language>();
  @Output() readonly toggleHealthyTraffic = new EventEmitter<void>();
  @Output() readonly triggerChaos = new EventEmitter<void>();
  @Output() readonly resetService = new EventEmitter<void>();

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
   * Emits the selected UI language when valid.
   */
  onLangSelect(lang: Language): void {
    if (isNonEmptyString(lang)) {
      this.langChange.emit(lang);
    }
  }
}

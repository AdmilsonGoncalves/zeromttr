import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  effect,
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

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'light' | 'dark' | 'auto';
      size?: 'normal' | 'compact' | 'flexible';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    }
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-api-script';
const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Top War Room header containing service status tags, FinOps badge, execution controls, and KPI strip.
 */
@Component({
  selector: 'app-war-room-header',
  imports: [FormsModule, SelectButton, Tag, Button, Tooltip],
  templateUrl: './war-room-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomHeaderComponent implements OnDestroy {
  readonly i18n: I18nService;

  readonly sseConnectedSignal = signal<boolean>(false);
  readonly targetStatusSignal = signal<TargetStatusResponse | null>(null);
  readonly finopsReductionSignal = signal<number>(0);
  readonly estimatedTokensSavedSignal = signal<number>(0);
  readonly activeModeSignal = signal<IncidentMode>(IncidentExecutionMode.REPLAY);
  readonly isWorkflowRunningSignal = signal<boolean>(false);
  readonly liveDemoKeySignal = signal<string>('');
  readonly publicLiveDemoSignal = signal<boolean>(false);
  readonly turnstileSiteKeySignal = signal<string | null>(null);
  readonly simulationLockedByTurnstileSignal = signal<boolean>(false);
  readonly turnstileResetTriggerSignal = signal<number>(0);
  readonly healthyTrafficActiveSignal = signal<boolean>(false);
  readonly isTogglingTrafficSignal = signal<boolean>(false);
  readonly isResettingSignal = signal<boolean>(false);
  readonly isSimulatingSignal = signal<boolean>(false);
  readonly ttdDisplaySignal = signal<string>('--');
  readonly ttprDisplaySignal = signal<string>('--');
  readonly signalsRatioSignal = signal<string>('0/4');
  readonly evidenceCoveragePercentSignal = signal<number>(0);
  readonly reasoningSourceSignal = signal<ReasoningSource | null>(null);

  private readonly turnstileHostSignal = signal<HTMLElement | null>(null);
  private turnstileWidgetId: string | null = null;
  private lastResetTrigger = 0;

  @ViewChild('turnstileContainer')
  set turnstileContainer(ref: ElementRef<HTMLElement> | undefined) {
    this.turnstileHostSignal.set(ref?.nativeElement ?? null);
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
  set publicLiveDemo(value: boolean) {
    this.publicLiveDemoSignal.set(value);
  }

  @Input()
  set turnstileSiteKey(value: string | null) {
    this.turnstileSiteKeySignal.set(value);
  }

  @Input()
  set simulationLockedByTurnstile(value: boolean) {
    this.simulationLockedByTurnstileSignal.set(value);
  }

  @Input()
  set turnstileResetTrigger(value: number) {
    this.turnstileResetTriggerSignal.set(value);
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
  @Output() readonly turnstileTokenChange = new EventEmitter<string | null>();
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

    try {
      effect(() => {
        const siteKey = this.turnstileSiteKeySignal();
        const host = this.turnstileHostSignal();
        if (isNonEmptyString(siteKey) && host && !this.turnstileWidgetId) {
          this.mountTurnstileWidget(host, siteKey);
        }
      });

      effect(() => {
        const trigger = this.turnstileResetTriggerSignal();
        if (trigger > this.lastResetTrigger) {
          this.lastResetTrigger = trigger;
          if (this.turnstileWidgetId && globalThis.window?.turnstile) {
            globalThis.window.turnstile.reset(this.turnstileWidgetId);
          }
        }
      });
    } catch {
      // Ignore effect registration outside Angular injection context in pure Node unit tests
    }
  }

  ngOnDestroy(): void {
    if (this.turnstileWidgetId && globalThis.window?.turnstile) {
      globalThis.window.turnstile.remove(this.turnstileWidgetId);
      this.turnstileWidgetId = null;
    }
  }

  private mountTurnstileWidget(host: HTMLElement, siteKey: string): void {
    const renderWidget = (): void => {
      if (!globalThis.window?.turnstile || this.turnstileWidgetId) {
        return;
      }
      this.turnstileWidgetId = globalThis.window.turnstile.render(host, {
        sitekey: siteKey,
        theme: 'dark',
        size: 'compact',
        callback: (token: string) => {
          this.turnstileTokenChange.emit(token);
        },
        'expired-callback': () => {
          this.turnstileTokenChange.emit(null);
        },
        'error-callback': () => {
          this.turnstileTokenChange.emit(null);
        }
      });
    };

    if (globalThis.window?.turnstile) {
      renderWidget();
      return;
    }

    const doc = globalThis.document;
    if (!doc) {
      return;
    }
    const existingScript = doc.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', renderWidget, { once: true });
      return;
    }

    const script = doc.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', renderWidget, { once: true });
    doc.head.appendChild(script);
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

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
import { isNonEmptyString } from '@zeromttr/utils';
import { Button } from 'primeng/button';
import { I18nService } from '../../core/i18n/i18n.service.js';

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
 * Operational notices bar rendering the Cloudflare Turnstile verification gate outside the pure header.
 */
@Component({
  selector: 'app-war-room-notices',
  imports: [Button],
  templateUrl: './war-room-notices.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomNoticesComponent implements OnDestroy {
  readonly i18n: I18nService;

  readonly turnstileSiteKeySignal = signal<string | null>(null);
  readonly simulationLockedByTurnstileSignal = signal<boolean>(false);
  readonly turnstileResetTriggerSignal = signal<number>(0);
  readonly turnstileLoadErrorSignal = signal<boolean>(false);

  private readonly turnstileHostSignal = signal<HTMLElement | null>(null);
  private turnstileWidgetId: string | null = null;
  private lastResetTrigger = 0;
  private isDestroyed = false;

  @ViewChild('turnstileContainer')
  set turnstileContainer(ref: ElementRef<HTMLElement> | undefined) {
    this.turnstileHostSignal.set(ref?.nativeElement ?? null);
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

  @Output() readonly turnstileTokenChange = new EventEmitter<string | null>();

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
    this.isDestroyed = true;
    if (this.turnstileWidgetId && globalThis.window?.turnstile) {
      globalThis.window.turnstile.remove(this.turnstileWidgetId);
      this.turnstileWidgetId = null;
    }
    this.turnstileTokenChange.emit(null);
  }

  /**
   * Retries loading the Cloudflare Turnstile script after a load failure.
   */
  retryTurnstileLoad(): void {
    const host = this.turnstileHostSignal();
    const siteKey = this.turnstileSiteKeySignal();
    if (!host || !isNonEmptyString(siteKey)) {
      return;
    }
    this.turnstileLoadErrorSignal.set(false);
    this.mountTurnstileWidget(host, siteKey);
  }

  private mountTurnstileWidget(host: HTMLElement, siteKey: string): void {
    const renderWidget = (): void => {
      if (this.isDestroyed || !globalThis.window?.turnstile || this.turnstileWidgetId) {
        return;
      }
      this.turnstileLoadErrorSignal.set(false);
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

    const handleScriptError = (scriptEl: HTMLScriptElement): void => {
      if (this.isDestroyed) {
        return;
      }
      this.turnstileLoadErrorSignal.set(true);
      this.turnstileTokenChange.emit(null);
      scriptEl.remove();
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
      existingScript.addEventListener('error', () => handleScriptError(existingScript), {
        once: true
      });
      return;
    }

    const script = doc.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', renderWidget, { once: true });
    script.addEventListener('error', () => handleScriptError(script), { once: true });
    doc.head.appendChild(script);
  }
}

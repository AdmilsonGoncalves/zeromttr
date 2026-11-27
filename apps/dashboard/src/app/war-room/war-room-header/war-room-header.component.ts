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
import { isNonEmptyString } from '@zeromttr/utils';
import { Tag } from 'primeng/tag';
import { Tooltip } from 'primeng/tooltip';
import {
  IncidentExecutionMode,
  TargetHealthStatus,
  type IncidentMode,
  type TargetStatusResponse
} from '../../core/contract.js';
import { I18nService, Language } from '../../core/i18n/i18n.service.js';
import { DemoSettingsComponent } from '../../shared/demo-settings/demo-settings.component.js';
import { LocaleSwitcherComponent } from '../../shared/locale-switcher/locale-switcher.component.js';
import { SystemSettingsComponent } from '../../shared/system-settings/system-settings.component.js';

const DEFAULT_PROD_DOCS_URL = 'https://docs.zeromttr.agjworks.com';
const DEFAULT_LOCAL_DOCS_URL = 'http://localhost:4300';
const RUNTIME_DOCS_DOMAIN_PLACEHOLDER = '__ZEROMTTR_DOCS_DOMAIN__';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const IPV4_HOSTNAME_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const SAFE_DOCS_DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{1,5})?$/i;

function isCustomPublicDomain(hostname: string): boolean {
  return hostname.includes('.') && !IPV4_HOSTNAME_PATTERN.test(hostname) && !hostname.includes(':');
}

function normalizeRuntimeDocsDomain(raw?: string | null): string | null {
  if (!isNonEmptyString(raw)) {
    return null;
  }
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === RUNTIME_DOCS_DOMAIN_PLACEHOLDER || trimmed.includes('${')) {
    return null;
  }
  if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) {
    return trimmed;
  }
  if (SAFE_DOCS_DOMAIN_PATTERN.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

function readRuntimeDocsDomainMeta(): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  return (
    document.querySelector('meta[name="zeromttr-docs-domain"]')?.getAttribute('content') ??
    undefined
  );
}

/**
 * Resolves the external Docusaurus user manual URL for the active dashboard locale.
 */
export function resolveDocsManualUrl(
  lang: Language,
  options?: { configuredBaseUrl?: string; runtimeDocsDomain?: string; hostname?: string }
): string {
  let baseUrl = DEFAULT_PROD_DOCS_URL;
  const normalizedHost = options?.hostname?.trim().toLowerCase();
  const runtimeBaseUrl = normalizeRuntimeDocsDomain(options?.runtimeDocsDomain);

  if (isNonEmptyString(options?.configuredBaseUrl)) {
    baseUrl = options.configuredBaseUrl.trim().replace(/\/+$/, '');
  } else if (runtimeBaseUrl) {
    baseUrl = runtimeBaseUrl;
  } else if (isNonEmptyString(normalizedHost) && LOCAL_HOSTNAMES.has(normalizedHost)) {
    baseUrl = DEFAULT_LOCAL_DOCS_URL;
  } else if (isNonEmptyString(normalizedHost) && isCustomPublicDomain(normalizedHost)) {
    baseUrl = normalizedHost.startsWith('docs.')
      ? `https://${normalizedHost}`
      : `https://docs.${normalizedHost}`;
  }

  let localePath = '/';
  if (lang === Language.EN_US) {
    localePath = '/en-US/';
  } else if (lang === Language.ES_ES) {
    localePath = '/es-ES/';
  }

  return `${baseUrl}${localePath}`;
}

/**
 * Pure top War Room header displaying project identity, target connection tags, demo drawer trigger, settings trigger, manual link, and locale switcher.
 */
@Component({
  selector: 'app-war-room-header',
  imports: [Tag, Tooltip, DemoSettingsComponent, SystemSettingsComponent, LocaleSwitcherComponent],
  templateUrl: './war-room-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WarRoomHeaderComponent {
  readonly i18n = inject(I18nService);
  readonly healthStatus = TargetHealthStatus;

  readonly docsManualUrl = computed<string>(() => {
    const configuredBaseUrl = import.meta.env?.VITE_DOCS_URL;
    const runtimeDocsDomain = readRuntimeDocsDomainMeta();
    const hostname = typeof window !== 'undefined' ? window.location.hostname : undefined;
    return resolveDocsManualUrl(this.i18n.currentLang(), {
      configuredBaseUrl,
      runtimeDocsDomain,
      hostname
    });
  });

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

  /**
   * Emits the selected UI language when valid.
   */
  onLangSelect(lang: Language): void {
    if (isNonEmptyString(lang)) {
      this.langChange.emit(lang);
    }
  }
}

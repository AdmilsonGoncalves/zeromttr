import { computed, Injectable, signal } from '@angular/core';
import {
  diffInSeconds,
  isFilled,
  isNonEmptyArray,
  isNonEmptyString,
  isNumber,
  percentage,
  round,
  safeJsonParse,
  toErrorMessage
} from '@zeromttr/utils';
import {
  DecisionAction,
  type DecisionPayload,
  type DemoConfigResponse,
  DecisionSource,
  type IncidentCreatedEvent,
  type IncidentDecisionAction,
  type IncidentDecisionEvent,
  type IncidentDetail,
  type IncidentDocsEvent,
  IncidentEventType,
  IncidentExecutionMode,
  type IncidentFinopsEvent,
  type IncidentMode,
  type IncidentNotifiedEvent,
  type IncidentRcaEvent,
  type IncidentRemediationEvent,
  IncidentState,
  type IncidentTransitionEvent,
  ReasoningProvider,
  type ReasoningSource,
  type SimulateDecisionPayload,
  type TargetStatusResponse
} from './contract.js';
import {
  DecisionUiStatus,
  FsmStageStatus,
  FsmVirtualState,
  TimelineStepStatus,
  UiSeverity
} from './constants.js';
import type { TranslationDictionary } from './i18n.service.js';

export interface TimelineStepItem {
  id: number;
  titleKey: keyof TranslationDictionary;
  descKey: keyof TranslationDictionary;
  status: TimelineStepStatus;
  icon: string;
  badge?: string;
  badgeSeverity?: UiSeverity;
}

export interface DemoActionResult {
  ok: boolean;
  status?: number;
  error?: string;
  errorCode?: string;
  retryAfterSeconds?: number;
}

export interface FsmStageItem {
  state: IncidentState | FsmVirtualState;
  labelKey: keyof TranslationDictionary;
  tooltipKey: keyof TranslationDictionary;
  status: FsmStageStatus;
}

const LIVE_DEMO_KEY_STORAGE_KEY = 'zeromttr_live_demo_key';
const VISUAL_STEP_INTERVAL_MS = 450;

/**
 * Signal-based state manager handling SSE incident streaming, polling, demo triggers, and signed decisions.
 */
@Injectable({
  providedIn: 'root'
})
export class IncidentService {
  private eventSource: EventSource | null = null;
  private liveWaitTimer: ReturnType<typeof setInterval> | null = null;
  private targetStatusPollTimer: ReturnType<typeof setInterval> | null = null;
  private sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private visualStepTimer: ReturnType<typeof setTimeout> | null = null;
  private visualStateQueue: IncidentState[] = [];
  private readonly dismissedIncidentIds = new Set<string>();
  private activeIncidentFetchToken = 0;
  private isSyncingFallback = false;
  private readonly incidentUpdateGeneration = new Map<string, number>();
  private chaosTriggeredAtMs = 0;

  readonly currentIncident = signal<IncidentDetail | null>(null);
  readonly targetStatus = signal<TargetStatusResponse | null>(null);
  readonly targetMetrics = computed(() => this.targetStatus()?.metrics ?? null);
  readonly sseConnected = signal<boolean>(false);
  readonly activeMode = signal<IncidentMode>(IncidentExecutionMode.REPLAY);
  readonly liveDemoKey = signal<string>('');
  readonly publicLiveDemo = signal<boolean>(false);
  readonly turnstileSiteKey = signal<string | null>(null);
  readonly turnstileRequired = signal<boolean>(false);
  readonly turnstileToken = signal<string | null>(null);
  readonly turnstileResetCounter = signal<number>(0);
  readonly isSimulationLockedByTurnstile = computed<boolean>(
    () => this.turnstileRequired() && !isNonEmptyString(this.turnstileToken())
  );
  readonly isSimulating = signal<boolean>(false);
  readonly isResetting = signal<boolean>(false);
  readonly isTogglingTraffic = signal<boolean>(false);
  readonly awaitingIncidentStart = signal<boolean>(false);
  readonly liveWaitSeconds = signal<number>(0);
  readonly stagedSseState = signal<IncidentState | null>(null);
  readonly decisionStatus = signal<DecisionUiStatus>(DecisionUiStatus.IDLE);
  readonly decisionStatusCode = signal<number | null>(null);
  readonly decisionError = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);

  readonly displayedFsmState = computed<IncidentState | undefined>(() => {
    const incident = this.currentIncident();
    if (!incident) {
      return undefined;
    }
    return this.stagedSseState() ?? incident.state;
  });

  readonly isWorkflowRunning = computed<boolean>(() => {
    if (this.isSimulating() || this.awaitingIncidentStart()) {
      return true;
    }
    const state = this.displayedFsmState();
    return (
      state === IncidentState.RECEIVED ||
      state === IncidentState.INVESTIGATING ||
      state === IncidentState.ENRICHING ||
      state === IncidentState.REMEDIATING ||
      state === IncidentState.AWAITING_PR
    );
  });

  constructor() {
    try {
      const savedKey = globalThis.localStorage?.getItem(LIVE_DEMO_KEY_STORAGE_KEY);
      if (isNonEmptyString(savedKey)) {
        this.liveDemoKey.set(savedKey);
      }
    } catch {
      // Ignore storage access errors in headless/SSR environments
    }
  }

  readonly finopsReduction = computed<number>(() => {
    const finops = this.currentIncident()?.finops;
    if (!isFilled(finops)) {
      return 0;
    }
    return round(finops.payloadReductionPercent, 1);
  });

  readonly estimatedTokensSaved = computed<number>(() => {
    const finops = this.currentIncident()?.finops;
    if (!isFilled(finops)) {
      return 0;
    }
    return finops.estimatedTokensSaved;
  });

  readonly evidenceCoveragePercent = computed<number>(() => {
    const rca = this.currentIncident()?.rca;
    if (!isFilled(rca)) {
      return 0;
    }
    if (rca.signalsTotal > 0) {
      return round(percentage(rca.signalsCollected, rca.signalsTotal, 0));
    }
    return rca.evidenceCoveragePercent;
  });

  readonly signalsRatio = computed<string>(() => {
    const rca = this.currentIncident()?.rca;
    if (!isFilled(rca)) {
      return '0/4';
    }
    return `${rca.signalsCollected}/${rca.signalsTotal}`;
  });

  readonly reasoningSource = computed<ReasoningSource | null>(() => {
    return this.currentIncident()?.rca?.reasoningSource ?? null;
  });

  readonly isPiiPassed = computed<boolean | null>(() => {
    const audit = this.currentIncident()?.rca?.piiGuardAudit;
    return audit ? audit.passed : null;
  });

  readonly ttdDisplay = computed<string>(() => {
    const sec = this.currentIncident()?.rca?.diagnosisSeconds;
    if (isNumber(sec)) {
      return `${sec}s`;
    }
    return '--';
  });

  readonly ttprDisplay = computed<string>(() => {
    const incident = this.currentIncident();
    if (!incident) {
      return '--';
    }
    const prTransition = incident.transitions?.find(
      (t) => t.to === IncidentState.AWAITING_PR || t.to === IncidentState.NOTIFIED
    );
    if (isNonEmptyString(incident.startedAt) && prTransition) {
      const diffSec = diffInSeconds(incident.startedAt, prTransition.at).toFixed(1);
      return `${diffSec}s`;
    }
    return '--';
  });

  readonly leakedPatternsCount = computed<number>(() => {
    return this.currentIncident()?.rca?.piiGuardAudit.leakedPatternsDetected ?? 0;
  });

  readonly fsmStages = computed<FsmStageItem[]>(() => {
    const incident = this.currentIncident();
    const currentState = this.displayedFsmState();
    const isAwaitingAlert = this.awaitingIncidentStart() && !currentState;

    const orderedIncidentStages: Array<{
      state: IncidentState;
      labelKey: keyof TranslationDictionary;
      tooltipKey: keyof TranslationDictionary;
    }> = [
      {
        state: IncidentState.RECEIVED,
        labelKey: 'fsmReceivedLabel',
        tooltipKey: 'fsmReceivedTip'
      },
      {
        state: IncidentState.INVESTIGATING,
        labelKey: 'fsmInvestigatingLabel',
        tooltipKey: 'fsmInvestigatingTip'
      },
      {
        state: IncidentState.ENRICHING,
        labelKey: 'fsmEnrichingLabel',
        tooltipKey: 'fsmEnrichingTip'
      },
      {
        state: IncidentState.REMEDIATING,
        labelKey: 'fsmRemediatingLabel',
        tooltipKey: 'fsmRemediatingTip'
      },
      {
        state: IncidentState.AWAITING_PR,
        labelKey: 'fsmAwaitingPrLabel',
        tooltipKey: 'fsmAwaitingPrTip'
      },
      {
        state: IncidentState.NOTIFIED,
        labelKey: 'fsmNotifiedLabel',
        tooltipKey: 'fsmNotifiedTip'
      },
      {
        state:
          currentState === IncidentState.REJECTED ? IncidentState.REJECTED : IncidentState.RESOLVED,
        labelKey: currentState === IncidentState.REJECTED ? 'fsmRejectedLabel' : 'fsmResolvedLabel',
        tooltipKey: currentState === IncidentState.REJECTED ? 'fsmRejectedTip' : 'fsmResolvedTip'
      }
    ];

    const awaitingAlertStage: FsmStageItem = {
      state: FsmVirtualState.AWAITING_ALERT,
      labelKey: 'fsmAwaitingAlertLabel',
      tooltipKey: 'fsmAwaitingAlertTip',
      status: currentState
        ? FsmStageStatus.COMPLETED
        : isAwaitingAlert
          ? FsmStageStatus.ACTIVE
          : FsmStageStatus.PENDING
    };

    if (!currentState) {
      return [
        awaitingAlertStage,
        ...orderedIncidentStages.map((stage) => ({ ...stage, status: 'pending' as const }))
      ];
    }

    if (currentState === IncidentState.FAILED) {
      const transitions = incident?.transitions ?? [];
      const failedTransition = [...transitions]
        .reverse()
        .find((t) => t.to === IncidentState.FAILED);
      const failedFromState = failedTransition?.from ?? null;
      const failedIdx = failedFromState
        ? orderedIncidentStages.findIndex((stage) => stage.state === failedFromState)
        : -1;

      if (failedIdx >= 0) {
        return [
          awaitingAlertStage,
          ...orderedIncidentStages.map((stage, idx) => {
            if (idx < failedIdx) {
              return { ...stage, status: 'completed' as const };
            }
            if (idx === failedIdx) {
              return { ...stage, labelKey: 'fsmFailedLabel' as const, status: 'failed' as const };
            }
            return { ...stage, status: 'pending' as const };
          })
        ];
      }

      const visited = new Set<IncidentState>(
        transitions.map((t) => t.to).filter((s) => s !== IncidentState.FAILED)
      );
      let failedMarked = false;
      return [
        awaitingAlertStage,
        ...orderedIncidentStages.map((stage) => {
          if (visited.has(stage.state)) {
            return { ...stage, status: 'completed' as const };
          }
          if (!failedMarked) {
            failedMarked = true;
            return { ...stage, labelKey: 'fsmFailedLabel' as const, status: 'failed' as const };
          }
          return { ...stage, status: 'pending' as const };
        })
      ];
    }

    const activeIdx = orderedIncidentStages.findIndex((s) => s.state === currentState);
    const isTerminal =
      currentState === IncidentState.RESOLVED || currentState === IncidentState.REJECTED;

    return [
      awaitingAlertStage,
      ...orderedIncidentStages.map((stage, idx) => {
        if (idx < activeIdx) {
          return { ...stage, status: 'completed' as const };
        }
        if (idx === activeIdx) {
          return {
            ...stage,
            status:
              currentState === IncidentState.REJECTED
                ? ('failed' as const)
                : isTerminal
                  ? ('completed' as const)
                  : ('active' as const)
          };
        }
        return { ...stage, status: 'pending' as const };
      })
    ];
  });

  readonly fsmHintKey = computed<keyof TranslationDictionary>(() => {
    const state = this.displayedFsmState();
    if (!state) {
      return this.awaitingIncidentStart() ? 'fsmHintAwaitingAlert' : 'fsmHintIdle';
    }
    if (state === IncidentState.NOTIFIED) {
      return 'fsmHintNotified';
    }
    if (state === IncidentState.RESOLVED) {
      return 'fsmHintResolved';
    }
    if (state === IncidentState.REJECTED) {
      return 'fsmHintRejected';
    }
    if (state === IncidentState.FAILED) {
      return 'fsmHintFailed';
    }
    return 'fsmHintActive';
  });

  readonly timelineSteps = computed<TimelineStepItem[]>(() => {
    const incident = this.currentIncident();
    const state: IncidentState = incident?.state ?? IncidentState.RECEIVED;

    const isDone = (targetStates: IncidentState[]): boolean => {
      return targetStates.includes(state);
    };

    const isCurrent = (targetState: IncidentState): boolean => {
      return state === targetState;
    };

    const rca = incident?.rca;

    const steps: TimelineStepItem[] = [
      {
        id: 1,
        titleKey: 'step1Title',
        descKey: 'step1Desc',
        status: isDone([
          IncidentState.RECEIVED,
          IncidentState.INVESTIGATING,
          IncidentState.ENRICHING,
          IncidentState.REMEDIATING,
          IncidentState.AWAITING_PR,
          IncidentState.NOTIFIED,
          IncidentState.RESOLVED,
          IncidentState.REJECTED
        ])
          ? 'completed'
          : 'pending',
        icon: 'pi pi-bolt',
        badge: 'p99 > 2000ms',
        badgeSeverity: 'danger'
      },
      {
        id: 2,
        titleKey: 'step2Title',
        descKey: 'step2Desc',
        status: isDone([
          IncidentState.INVESTIGATING,
          IncidentState.ENRICHING,
          IncidentState.REMEDIATING,
          IncidentState.AWAITING_PR,
          IncidentState.NOTIFIED,
          IncidentState.RESOLVED,
          IncidentState.REJECTED
        ])
          ? 'completed'
          : isCurrent(IncidentState.RECEIVED)
            ? 'in-progress'
            : 'pending',
        icon: 'pi pi-chart-line',
        badge: '+50% (PromQL & Exemplar)',
        badgeSeverity: 'info'
      },
      {
        id: 3,
        titleKey: 'step3Title',
        descKey: 'step3Desc',
        status: isDone([
          IncidentState.ENRICHING,
          IncidentState.REMEDIATING,
          IncidentState.AWAITING_PR,
          IncidentState.NOTIFIED,
          IncidentState.RESOLVED,
          IncidentState.REJECTED
        ])
          ? 'completed'
          : isCurrent(IncidentState.INVESTIGATING)
            ? 'in-progress'
            : 'pending',
        icon: 'pi pi-clock',
        badge: '+25% (Tempo Span)',
        badgeSeverity: 'info'
      },
      {
        id: 4,
        titleKey: 'step4Title',
        descKey: 'step4Desc',
        status: isDone([
          IncidentState.ENRICHING,
          IncidentState.REMEDIATING,
          IncidentState.AWAITING_PR,
          IncidentState.NOTIFIED,
          IncidentState.RESOLVED,
          IncidentState.REJECTED
        ])
          ? 'completed'
          : isCurrent(IncidentState.INVESTIGATING)
            ? 'in-progress'
            : 'pending',
        icon: 'pi pi-shield',
        badge: 'OTTL Masked',
        badgeSeverity: 'success'
      },
      {
        id: 5,
        titleKey: 'step5Title',
        descKey: 'step5Desc',
        status: isDone([
          IncidentState.ENRICHING,
          IncidentState.REMEDIATING,
          IncidentState.AWAITING_PR,
          IncidentState.NOTIFIED,
          IncidentState.RESOLVED,
          IncidentState.REJECTED
        ])
          ? 'completed'
          : isCurrent(IncidentState.INVESTIGATING)
            ? 'in-progress'
            : 'pending',
        icon: 'pi pi-github',
        badge: '4/4 Sinais (100%)',
        badgeSeverity: 'success'
      },
      {
        id: 6,
        titleKey: 'step6Title',
        descKey: 'step6Desc',
        status: isDone([
          IncidentState.REMEDIATING,
          IncidentState.AWAITING_PR,
          IncidentState.NOTIFIED,
          IncidentState.RESOLVED,
          IncidentState.REJECTED
        ])
          ? 'completed'
          : isCurrent(IncidentState.ENRICHING)
            ? 'in-progress'
            : 'pending',
        icon: 'pi pi-lock',
        badge: rca?.piiGuardAudit.passed ? 'Fail-Closed: 0 Leaked' : 'Fail-Closed: Triggered',
        badgeSeverity: rca?.piiGuardAudit.passed ? 'success' : 'danger'
      },
      {
        id: 7,
        titleKey: 'step7Title',
        descKey: 'step7Desc',
        status: isDone([
          IncidentState.AWAITING_PR,
          IncidentState.NOTIFIED,
          IncidentState.RESOLVED,
          IncidentState.REJECTED
        ])
          ? 'completed'
          : isCurrent(IncidentState.REMEDIATING)
            ? 'in-progress'
            : 'pending',
        icon: 'pi pi-code',
        badge: rca?.reasoningSource === ReasoningProvider.LLM ? 'Gemini LLM' : 'Fallback',
        badgeSeverity: 'info'
      },
      {
        id: 8,
        titleKey: 'step8Title',
        descKey: 'step8Desc',
        status: isDone([IncidentState.NOTIFIED, IncidentState.RESOLVED, IncidentState.REJECTED])
          ? 'completed'
          : isCurrent(IncidentState.AWAITING_PR)
            ? 'in-progress'
            : 'pending',
        icon: 'pi pi-envelope',
        badge: 'Resend HMAC in #fragment',
        badgeSeverity: 'contrast'
      }
    ];

    return steps;
  });

  /**
   * Updates the active demo execution mode (`live` or `replay`).
   */
  setActiveMode(mode: IncidentMode): void {
    this.activeMode.set(mode);
  }

  /**
   * Stores the live demo authorization key in memory and `localStorage` for protected chaos triggers.
   */
  setLiveDemoKey(key: string): void {
    this.liveDemoKey.set(key);
    try {
      if (isNonEmptyString(key)) {
        globalThis.localStorage?.setItem(LIVE_DEMO_KEY_STORAGE_KEY, key);
      } else {
        globalThis.localStorage?.removeItem(LIVE_DEMO_KEY_STORAGE_KEY);
      }
    } catch {
      // Ignore storage access errors
    }
  }

  private startLiveWaitTimer(): void {
    this.stopLiveWaitTimer();
    this.liveWaitSeconds.set(0);
    this.liveWaitTimer = setInterval(() => {
      this.liveWaitSeconds.update((sec) => sec + 1);
    }, 1000);
  }

  private stopLiveWaitTimer(): void {
    if (this.liveWaitTimer) {
      clearInterval(this.liveWaitTimer);
      this.liveWaitTimer = null;
    }
    this.liveWaitSeconds.set(0);
  }

  private clearVisualStateQueue(): void {
    if (this.visualStepTimer) {
      clearTimeout(this.visualStepTimer);
      this.visualStepTimer = null;
    }
    this.visualStateQueue = [];
    this.stagedSseState.set(null);
  }

  private scheduleNextVisualStep(): void {
    if (this.visualStepTimer) {
      return;
    }
    this.visualStepTimer = setTimeout(() => {
      this.visualStepTimer = null;
      const next = this.visualStateQueue.shift();
      if (next) {
        this.stagedSseState.set(next);
        this.scheduleNextVisualStep();
      } else {
        this.stagedSseState.set(null);
      }
    }, VISUAL_STEP_INTERVAL_MS);
  }

  private enqueueVisualState(state: IncidentState): void {
    if (
      state === IncidentState.RESOLVED ||
      state === IncidentState.REJECTED ||
      state === IncidentState.FAILED
    ) {
      this.clearVisualStateQueue();
      return;
    }
    if (!this.visualStepTimer && this.stagedSseState() === null) {
      this.stagedSseState.set(state);
      this.scheduleNextVisualStep();
      return;
    }
    const lastQueued =
      this.visualStateQueue[this.visualStateQueue.length - 1] ?? this.stagedSseState();
    if (lastQueued !== state) {
      this.visualStateQueue.push(state);
      this.scheduleNextVisualStep();
    }
  }

  private hydrateMissedIncidentFromSse(incidentId: string, baseUrl: string): void {
    if (this.dismissedIncidentIds.has(incidentId)) {
      return;
    }
    this.awaitingIncidentStart.set(false);
    this.stopLiveWaitTimer();
    const curr = this.currentIncident();
    if (!curr || curr.id !== incidentId) {
      void this.fetchIncident(incidentId, baseUrl);
    }
  }

  /**
   * Opens an SSE subscription to stream real-time incident lifecycle updates.
   */
  connectSse(baseUrl = ''): void {
    if (this.eventSource) {
      this.disconnectSse();
    }

    try {
      const es = new EventSource(`${baseUrl}/api/events`);
      this.eventSource = es;
      this.attachSseLifecycle(es, baseUrl);
      this.registerSseEventHandlers(es, baseUrl);
    } catch {
      this.sseConnected.set(false);
    }
  }

  private attachSseLifecycle(es: EventSource, baseUrl: string): void {
    es.onopen = (): void => {
      this.sseConnected.set(true);
    };

    es.onerror = (): void => {
      this.sseConnected.set(false);
      if (es.readyState === EventSource.CLOSED && !this.sseReconnectTimer) {
        this.sseReconnectTimer = setTimeout(() => {
          this.sseReconnectTimer = null;
          this.connectSse(baseUrl);
        }, 3000);
      }
    };

    es.addEventListener('heartbeat', (_evt: MessageEvent) => {
      this.sseConnected.set(true);
    });
  }

  private registerSseEventHandlers(es: EventSource, baseUrl: string): void {
    this.registerIncidentListener<IncidentCreatedEvent>(es, IncidentEventType.CREATED, (payload) =>
      this.handleCreatedEvent(payload)
    );
    this.registerIncidentListener<IncidentTransitionEvent>(
      es,
      IncidentEventType.TRANSITION,
      (payload) => this.handleTransitionEvent(payload, baseUrl)
    );
    this.registerIncidentListener<IncidentRcaEvent>(es, IncidentEventType.RCA, (payload) =>
      this.handleRcaEvent(payload, baseUrl)
    );
    this.registerIncidentListener<IncidentFinopsEvent>(es, IncidentEventType.FINOPS, (payload) =>
      this.handleFinopsEvent(payload, baseUrl)
    );
    this.registerIncidentListener<IncidentDocsEvent>(es, IncidentEventType.DOCS, (payload) =>
      this.handleDocsEvent(payload, baseUrl)
    );
    this.registerIncidentListener<IncidentRemediationEvent>(
      es,
      IncidentEventType.REMEDIATION,
      (payload) => this.handleRemediationEvent(payload, baseUrl)
    );
    this.registerIncidentListener<IncidentNotifiedEvent>(
      es,
      IncidentEventType.NOTIFIED,
      (payload) => this.handleNotifiedEvent(payload, baseUrl)
    );
    this.registerIncidentListener<IncidentDecisionEvent>(
      es,
      IncidentEventType.DECISION,
      (payload) => this.handleDecisionEvent(payload, baseUrl)
    );
  }

  private registerIncidentListener<T extends { incidentId: string }>(
    es: EventSource,
    eventType: string,
    handler: (payload: T) => void
  ): void {
    es.addEventListener(eventType, (evt: MessageEvent) => {
      const payload = safeJsonParse<T>(evt.data);
      if (!payload || this.dismissedIncidentIds.has(payload.incidentId)) {
        return;
      }
      handler(payload);
    });
  }

  private patchCurrentIncident(
    incidentId: string,
    baseUrl: string,
    hydrateIfMissing: boolean,
    updater: (curr: IncidentDetail) => IncidentDetail
  ): boolean {
    if (hydrateIfMissing) {
      const currBefore = this.currentIncident();
      if (!currBefore || currBefore.id !== incidentId) {
        this.hydrateMissedIncidentFromSse(incidentId, baseUrl);
        return false;
      }
    }

    this.bumpIncidentGeneration(incidentId);
    this.currentIncident.update((curr) => {
      if (!curr || curr.id !== incidentId) {
        return curr;
      }
      return updater(curr);
    });
    return true;
  }

  private handleCreatedEvent(payload: IncidentCreatedEvent): void {
    this.awaitingIncidentStart.set(false);
    this.stopLiveWaitTimer();
    const current = this.currentIncident();
    if (!current || current.id !== payload.incidentId) {
      this.activeIncidentFetchToken++;
      this.bumpIncidentGeneration(payload.incidentId);
      this.clearVisualStateQueue();
      this.currentIncident.set({
        id: payload.incidentId,
        service: payload.service,
        severity: payload.severity,
        state: IncidentState.RECEIVED,
        mode: payload.mode,
        startedAt: payload.at,
        transitions: [{ from: null, to: IncidentState.RECEIVED, at: payload.at }]
      });
      this.enqueueVisualState(IncidentState.RECEIVED);
    }
  }

  private handleTransitionEvent(payload: IncidentTransitionEvent, baseUrl: string): void {
    const applied = this.patchCurrentIncident(payload.incidentId, baseUrl, true, (curr) => ({
      ...curr,
      state: payload.to,
      transitions: [
        ...curr.transitions,
        { from: payload.from, to: payload.to, at: payload.at, reason: payload.reason }
      ]
    }));
    if (applied) {
      this.enqueueVisualState(payload.to);
    }
  }

  private handleRcaEvent(payload: IncidentRcaEvent, baseUrl: string): void {
    const { incidentId, ...rca } = payload;
    this.patchCurrentIncident(incidentId, baseUrl, true, (curr) => ({
      ...curr,
      rca
    }));
  }

  private handleFinopsEvent(payload: IncidentFinopsEvent, baseUrl: string): void {
    const { incidentId, ...finops } = payload;
    this.patchCurrentIncident(incidentId, baseUrl, false, (curr) => ({
      ...curr,
      finops
    }));
  }

  private handleDocsEvent(payload: IncidentDocsEvent, baseUrl: string): void {
    this.patchCurrentIncident(payload.incidentId, baseUrl, false, (curr) => ({
      ...curr,
      docs: payload.sources
    }));
  }

  private handleRemediationEvent(payload: IncidentRemediationEvent, baseUrl: string): void {
    this.patchCurrentIncident(payload.incidentId, baseUrl, true, (curr) => ({
      ...curr,
      remediation: {
        branchName: payload.branchName,
        branchUrl: payload.branchUrl,
        pullRequestUrl: payload.pullRequestUrl,
        commitSha: payload.commitSha,
        suspectCommitSha: payload.suspectCommitSha
      }
    }));
  }

  private handleNotifiedEvent(payload: IncidentNotifiedEvent, baseUrl: string): void {
    this.patchCurrentIncident(payload.incidentId, baseUrl, true, (curr) => ({
      ...curr,
      notification: {
        emailId: payload.emailId,
        htmlPreview: payload.htmlPreview,
        status: payload.status
      }
    }));
  }

  private handleDecisionEvent(payload: IncidentDecisionEvent, baseUrl: string): void {
    this.clearVisualStateQueue();
    this.patchCurrentIncident(payload.incidentId, baseUrl, false, (curr) => ({
      ...curr,
      decision: payload.action,
      decisionSource: payload.source,
      state:
        payload.action === DecisionAction.APPROVE ? IncidentState.RESOLVED : IncidentState.REJECTED
    }));
  }

  /**
   * Closes the active SSE connection and clears pending client timers.
   */
  disconnectSse(): void {
    this.stopLiveWaitTimer();
    this.clearVisualStateQueue();
    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.sseConnected.set(false);
  }

  /**
   * Fetches the incident list and loads details for the most recent incident.
   */
  async fetchIncidents(baseUrl = ''): Promise<void> {
    try {
      const res = await fetch(`${baseUrl}/api/incidents`);
      if (res.ok) {
        const incidents = (await res.json()) as IncidentDetail[];
        if (isNonEmptyArray<IncidentDetail>(incidents)) {
          await this.fetchIncident(incidents[0].id, baseUrl);
        }
        this.loadError.set(null);
      } else {
        this.loadError.set(`Failed to fetch incidents: HTTP ${res.status}`);
      }
    } catch (err) {
      this.loadError.set(toErrorMessage(err));
    }
  }

  /**
   * Fetches incident details without mutating War Room selection or applying dismissed guards.
   */
  async getIncidentDetail(id: string, baseUrl = ''): Promise<IncidentDetail | null> {
    try {
      const res = await fetch(`${baseUrl}/api/incidents/${encodeURIComponent(id)}`);
      if (!res.ok) {
        return null;
      }
      return (await res.json()) as IncidentDetail;
    } catch {
      return null;
    }
  }

  private bumpIncidentGeneration(incidentId: string): void {
    this.incidentUpdateGeneration.set(
      incidentId,
      (this.incidentUpdateGeneration.get(incidentId) ?? 0) + 1
    );
  }

  /**
   * Fetches full details for a specific incident by ID.
   */
  async fetchIncident(id: string, baseUrl = ''): Promise<boolean> {
    if (this.dismissedIncidentIds.has(id)) {
      return false;
    }
    const token = ++this.activeIncidentFetchToken;
    const generationAtStart = this.incidentUpdateGeneration.get(id) ?? 0;
    try {
      const res = await fetch(`${baseUrl}/api/incidents/${encodeURIComponent(id)}`);
      if (token !== this.activeIncidentFetchToken || this.dismissedIncidentIds.has(id)) {
        return false;
      }
      if (res.ok) {
        const detail = (await res.json()) as IncidentDetail;
        const currentGeneration = this.incidentUpdateGeneration.get(id) ?? 0;
        if (
          token === this.activeIncidentFetchToken &&
          !this.dismissedIncidentIds.has(id) &&
          currentGeneration === generationAtStart
        ) {
          this.currentIncident.set(detail);
          this.loadError.set(null);
          return true;
        }
        return false;
      } else {
        this.loadError.set(`Failed to fetch incident ${id}: HTTP ${res.status}`);
        return false;
      }
    } catch (err) {
      if (token === this.activeIncidentFetchToken && !this.dismissedIncidentIds.has(id)) {
        this.loadError.set(toErrorMessage(err));
      }
      return false;
    }
  }

  /**
   * Polls the current health and version status of the target service.
   */
  async fetchTargetStatus(baseUrl = ''): Promise<void> {
    try {
      const res = await fetch(`${baseUrl}/api/target/status`);
      if (res.ok) {
        const status = (await res.json()) as TargetStatusResponse;
        this.targetStatus.set(status);
        this.loadError.set(null);
      } else {
        this.loadError.set(`Failed to fetch target status: HTTP ${res.status}`);
      }
    } catch (err) {
      this.loadError.set(toErrorMessage(err));
    }
  }

  /**
   * Fetches runtime demo configuration (`publicLiveDemo`, `turnstileSiteKey`, `turnstileRequired`).
   */
  async fetchDemoConfig(baseUrl = ''): Promise<void> {
    try {
      const res = await fetch(`${baseUrl}/api/demo/config`);
      if (res.ok) {
        const config = (await res.json()) as Partial<DemoConfigResponse>;
        this.publicLiveDemo.set(config.publicLiveDemo === true);
        this.turnstileSiteKey.set(
          isNonEmptyString(config.turnstileSiteKey) ? config.turnstileSiteKey : null
        );
        this.turnstileRequired.set(config.turnstileRequired === true);
      }
    } catch {
      // Keep safe defaults if config endpoint is unavailable
    }
  }

  /**
   * Updates the active Cloudflare Turnstile verification token.
   */
  setTurnstileToken(token: string | null): void {
    this.turnstileToken.set(isNonEmptyString(token) ? token.trim() : null);
  }

  private reserveTurnstileToken(): string | null {
    const token = this.turnstileToken();
    if (!isNonEmptyString(token)) {
      return null;
    }
    const trimmed = token.trim();
    if (this.turnstileRequired()) {
      this.turnstileToken.set(null);
    }
    return trimmed;
  }

  private resetTurnstileAfterRequest(reservedToken: string | null): void {
    if (this.turnstileRequired() && isNonEmptyString(reservedToken)) {
      if (this.turnstileToken() === reservedToken) {
        this.turnstileToken.set(null);
      }
      this.turnstileResetCounter.update((c) => c + 1);
    }
  }

  private buildDemoHeaders(
    includeJsonContentType = false,
    turnstileToken: string | null = this.turnstileToken()
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    if (includeJsonContentType) {
      headers['Content-Type'] = 'application/json';
    }
    const key = this.liveDemoKey();
    if (isNonEmptyString(key)) {
      headers['X-Live-Demo-Key'] = key.trim();
    }
    if (isNonEmptyString(turnstileToken)) {
      headers['CF-Turnstile-Response'] = turnstileToken.trim();
    }
    return headers;
  }

  private async readErrorPayload(
    res: Response
  ): Promise<{ error: string; errorCode?: string; retryAfterSeconds?: number }> {
    try {
      const body = (await res.json()) as {
        error?: unknown;
        code?: unknown;
        retryAfterSeconds?: unknown;
      };
      const errorCode = isNonEmptyString(body?.code) ? body.code : undefined;
      const retryAfterSeconds = isNumber(body?.retryAfterSeconds)
        ? body.retryAfterSeconds
        : undefined;
      if (isNonEmptyString(body?.error)) {
        return {
          error: body.error,
          ...(errorCode !== undefined ? { errorCode } : {}),
          ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {})
        };
      }
      if (retryAfterSeconds !== undefined || errorCode !== undefined) {
        return {
          error: `HTTP ${res.status}`,
          ...(errorCode !== undefined ? { errorCode } : {}),
          ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {})
        };
      }
    } catch {
      // Ignore non-JSON error payloads
    }
    return { error: `HTTP ${res.status}` };
  }

  /**
   * Starts periodic polling of `/api/target/status` so live telemetry metrics stay current
   * and recovers missed incident updates when SSE is offline.
   */
  startTargetStatusPolling(baseUrl = '', intervalMs = 2000): void {
    this.stopTargetStatusPolling();
    this.targetStatusPollTimer = setInterval(() => {
      void this.fetchTargetStatus(baseUrl);
      if (this.awaitingIncidentStart() || !this.sseConnected()) {
        void this.syncIncidentFallback(baseUrl);
      }
    }, intervalMs);
  }

  private async syncIncidentFallback(baseUrl = ''): Promise<void> {
    if (this.isSyncingFallback) {
      return;
    }
    this.isSyncingFallback = true;
    try {
      if (this.awaitingIncidentStart()) {
        try {
          const res = await fetch(`${baseUrl}/api/incidents`);
          if (res.ok) {
            const list = (await res.json()) as Array<{ id: string; startedAt?: string }>;
            const minStartedAt = this.chaosTriggeredAtMs > 0 ? this.chaosTriggeredAtMs - 5000 : 0;
            const latest = Array.isArray(list)
              ? list.find((inc) => {
                  if (!isNonEmptyString(inc?.id) || this.dismissedIncidentIds.has(inc.id)) {
                    return false;
                  }
                  if (minStartedAt > 0 && isNonEmptyString(inc.startedAt)) {
                    const startedMs = new Date(inc.startedAt).getTime();
                    if (!Number.isNaN(startedMs) && startedMs < minStartedAt) {
                      return false;
                    }
                  }
                  return true;
                })
              : undefined;
            if (latest) {
              const loaded = await this.fetchIncident(latest.id, baseUrl);
              if (loaded) {
                this.awaitingIncidentStart.set(false);
                this.stopLiveWaitTimer();
              }
            }
          }
        } catch {
          // Ignore transient polling errors
        }
        return;
      }

      const curr = this.currentIncident();
      if (
        curr &&
        curr.state !== IncidentState.RESOLVED &&
        curr.state !== IncidentState.REJECTED &&
        curr.state !== IncidentState.FAILED
      ) {
        await this.fetchIncident(curr.id, baseUrl);
      }
    } finally {
      this.isSyncingFallback = false;
    }
  }

  /**
   * Stops periodic polling of `/api/target/status`.
   */
  stopTargetStatusPolling(): void {
    if (this.targetStatusPollTimer) {
      clearInterval(this.targetStatusPollTimer);
      this.targetStatusPollTimer = null;
    }
  }

  /**
   * Toggles continuous healthy synthetic traffic on the target workload in live mode.
   */
  async toggleHealthyTraffic(enable: boolean, baseUrl = ''): Promise<DemoActionResult> {
    this.isTogglingTraffic.set(true);
    const reservedToken = this.reserveTurnstileToken();
    try {
      const res = await fetch(`${baseUrl}/api/demo/healthy-traffic`, {
        method: 'POST',
        headers: this.buildDemoHeaders(true, reservedToken),
        body: JSON.stringify({ enable })
      });

      if (!res.ok) {
        await this.fetchTargetStatus(baseUrl);
        const errPayload = await this.readErrorPayload(res);
        return {
          ok: false,
          status: res.status,
          ...errPayload
        };
      }

      await this.fetchTargetStatus(baseUrl);
      return { ok: true, status: res.status };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    } finally {
      this.resetTurnstileAfterRequest(reservedToken);
      this.isTogglingTraffic.set(false);
    }
  }

  /**
   * Triggers a chaos or replay simulation on the orchestrator demo API.
   */
  async triggerChaos(baseUrl = ''): Promise<DemoActionResult> {
    this.isSimulating.set(true);
    const reservedToken = this.reserveTurnstileToken();

    try {
      const mode = this.activeMode();
      const previousIncident = this.currentIncident();
      const res = await fetch(`${baseUrl}/api/demo/chaos`, {
        method: 'POST',
        headers: this.buildDemoHeaders(true, reservedToken),
        body: JSON.stringify({ mode })
      });

      if (!res.ok) {
        await this.fetchTargetStatus(baseUrl);
        const errPayload = await this.readErrorPayload(res);
        return {
          ok: false,
          status: res.status,
          ...errPayload
        };
      }

      if (previousIncident) {
        this.dismissedIncidentIds.add(previousIncident.id);
      }

      this.clearVisualStateQueue();
      this.chaosTriggeredAtMs = Date.now();
      this.currentIncident.set(null);
      this.awaitingIncidentStart.set(true);

      if (mode === IncidentExecutionMode.LIVE) {
        this.startLiveWaitTimer();
      } else {
        this.stopLiveWaitTimer();
      }

      await this.fetchTargetStatus(baseUrl);
      return { ok: true, status: res.status };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    } finally {
      this.resetTurnstileAfterRequest(reservedToken);
      this.isSimulating.set(false);
    }
  }

  /**
   * Resets target service chaos state and refreshes incident and target signals.
   */
  async resetChaos(baseUrl = '', clearIncident = false): Promise<DemoActionResult> {
    this.isResetting.set(true);
    const reservedToken = this.reserveTurnstileToken();
    try {
      const res = await fetch(`${baseUrl}/api/demo/reset`, {
        method: 'POST',
        headers: this.buildDemoHeaders(false, reservedToken)
      });
      await this.fetchTargetStatus(baseUrl);
      if (!res.ok) {
        const errPayload = await this.readErrorPayload(res);
        return {
          ok: false,
          status: res.status,
          ...errPayload
        };
      }

      if (clearIncident) {
        this.activeIncidentFetchToken++;
        const current = this.currentIncident();
        if (current) {
          this.dismissedIncidentIds.add(current.id);
        }
        this.awaitingIncidentStart.set(false);
        this.stopLiveWaitTimer();
        this.clearVisualStateQueue();
        this.currentIncident.set(null);
      } else {
        const current = this.currentIncident();
        if (current) {
          await this.fetchIncident(current.id, baseUrl);
        }
      }
      return { ok: true, status: res.status };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    } finally {
      this.resetTurnstileAfterRequest(reservedToken);
      this.isResetting.set(false);
    }
  }

  /**
   * Simulates an on-call decision on the current incident in demo mode.
   */
  async simulateDecision(action: IncidentDecisionAction, baseUrl = ''): Promise<DemoActionResult> {
    const incident = this.currentIncident();
    if (!incident) {
      return { ok: false, error: 'No active incident selected' };
    }

    const reservedToken = this.reserveTurnstileToken();
    const payload: SimulateDecisionPayload = {
      incidentId: incident.id,
      action
    };

    try {
      const res = await fetch(`${baseUrl}/api/demo/simulate-decision`, {
        method: 'POST',
        headers: this.buildDemoHeaders(true, reservedToken),
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        this.bumpIncidentGeneration(payload.incidentId);
        this.clearVisualStateQueue();
        this.currentIncident.update((curr) => {
          if (!curr) {
            return null;
          }
          return {
            ...curr,
            decision: action,
            decisionSource: DecisionSource.DEMO_SIMULATION,
            state:
              action === DecisionAction.APPROVE ? IncidentState.RESOLVED : IncidentState.REJECTED
          };
        });
        await this.fetchTargetStatus(baseUrl);
        return { ok: true, status: res.status };
      }

      const errPayload = await this.readErrorPayload(res);
      return {
        ok: false,
        status: res.status,
        ...errPayload
      };
    } catch (err) {
      return { ok: false, error: toErrorMessage(err) };
    } finally {
      this.resetTurnstileAfterRequest(reservedToken);
    }
  }

  /**
   * Submits a signed human-in-the-loop incident decision to the backend API.
   */
  async submitDecision(
    incidentId: string,
    payload: DecisionPayload,
    baseUrl = ''
  ): Promise<boolean> {
    this.decisionStatus.set(DecisionUiStatus.LOADING);
    try {
      const res = await fetch(
        `${baseUrl}/api/incidents/${encodeURIComponent(incidentId)}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );

      this.decisionStatusCode.set(res.status);
      if (res.ok) {
        this.decisionStatus.set(DecisionUiStatus.SUCCESS);
        this.decisionError.set(null);
        return true;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      this.decisionStatus.set(DecisionUiStatus.ERROR);
      this.decisionError.set(data?.error ?? null);
      return false;
    } catch (err) {
      this.decisionStatus.set(DecisionUiStatus.ERROR);
      this.decisionStatusCode.set(null);
      this.decisionError.set(toErrorMessage(err));
      return false;
    }
  }
}

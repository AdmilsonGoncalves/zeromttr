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
  private visualStepTimer: ReturnType<typeof setTimeout> | null = null;
  private visualStateQueue: IncidentState[] = [];
  private readonly dismissedIncidentIds = new Set<string>();
  private activeIncidentFetchToken = 0;

  readonly currentIncident = signal<IncidentDetail | null>(null);
  readonly targetStatus = signal<TargetStatusResponse | null>(null);
  readonly sseConnected = signal<boolean>(false);
  readonly activeMode = signal<IncidentMode>(IncidentExecutionMode.REPLAY);
  readonly liveDemoKey = signal<string>('');
  readonly isSimulating = signal<boolean>(false);
  readonly isResetting = signal<boolean>(false);
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
      const url = `${baseUrl}/api/events`;
      const es = new EventSource(url);
      this.eventSource = es;

      es.onopen = (): void => {
        this.sseConnected.set(true);
      };

      es.onerror = (): void => {
        this.sseConnected.set(false);
      };

      es.addEventListener('heartbeat', (_evt: MessageEvent) => {
        // Heartbeat keeps connection alive
      });

      es.addEventListener(IncidentEventType.CREATED, (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentCreatedEvent>(evt.data);
        if (!payload || this.dismissedIncidentIds.has(payload.incidentId)) {
          return;
        }
        this.awaitingIncidentStart.set(false);
        this.stopLiveWaitTimer();
        const current = this.currentIncident();
        if (!current || current.id !== payload.incidentId) {
          this.activeIncidentFetchToken++;
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
      });

      es.addEventListener(IncidentEventType.TRANSITION, (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentTransitionEvent>(evt.data);
        if (!payload || this.dismissedIncidentIds.has(payload.incidentId)) {
          return;
        }
        const currBefore = this.currentIncident();
        if (!currBefore || currBefore.id !== payload.incidentId) {
          this.hydrateMissedIncidentFromSse(payload.incidentId, baseUrl);
          return;
        }
        this.currentIncident.update((curr) => {
          if (!curr || curr.id !== payload.incidentId) {
            return curr;
          }
          const updatedTransitions = [
            ...curr.transitions,
            { from: payload.from, to: payload.to, at: payload.at, reason: payload.reason }
          ];
          return {
            ...curr,
            state: payload.to,
            transitions: updatedTransitions
          };
        });
        this.enqueueVisualState(payload.to);
      });

      es.addEventListener(IncidentEventType.RCA, (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentRcaEvent>(evt.data);
        if (!payload || this.dismissedIncidentIds.has(payload.incidentId)) {
          return;
        }
        const currBefore = this.currentIncident();
        if (!currBefore || currBefore.id !== payload.incidentId) {
          this.hydrateMissedIncidentFromSse(payload.incidentId, baseUrl);
          return;
        }
        const { incidentId: _incidentId, ...rca } = payload;
        this.currentIncident.update((curr) => {
          if (!curr || curr.id !== payload.incidentId) {
            return curr;
          }
          return {
            ...curr,
            rca
          };
        });
      });

      es.addEventListener(IncidentEventType.FINOPS, (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentFinopsEvent>(evt.data);
        if (!payload || this.dismissedIncidentIds.has(payload.incidentId)) {
          return;
        }
        const { incidentId: _incidentId, ...finops } = payload;
        this.currentIncident.update((curr) => {
          if (!curr || curr.id !== payload.incidentId) {
            return curr;
          }
          return {
            ...curr,
            finops
          };
        });
      });

      es.addEventListener(IncidentEventType.DOCS, (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentDocsEvent>(evt.data);
        if (!payload || this.dismissedIncidentIds.has(payload.incidentId)) {
          return;
        }
        const { incidentId: _incidentId, sources } = payload;
        this.currentIncident.update((curr) => {
          if (!curr || curr.id !== payload.incidentId) {
            return curr;
          }
          return {
            ...curr,
            docs: sources
          };
        });
      });

      es.addEventListener(IncidentEventType.REMEDIATION, (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentRemediationEvent>(evt.data);
        if (!payload || this.dismissedIncidentIds.has(payload.incidentId)) {
          return;
        }
        const currBefore = this.currentIncident();
        if (!currBefore || currBefore.id !== payload.incidentId) {
          this.hydrateMissedIncidentFromSse(payload.incidentId, baseUrl);
          return;
        }
        this.currentIncident.update((curr) => {
          if (!curr || curr.id !== payload.incidentId) {
            return curr;
          }
          return {
            ...curr,
            remediation: {
              branchName: payload.branchName,
              branchUrl: payload.branchUrl,
              pullRequestUrl: payload.pullRequestUrl,
              commitSha: payload.commitSha,
              suspectCommitSha: payload.suspectCommitSha
            }
          };
        });
      });

      es.addEventListener(IncidentEventType.NOTIFIED, (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentNotifiedEvent>(evt.data);
        if (!payload || this.dismissedIncidentIds.has(payload.incidentId)) {
          return;
        }
        const currBefore = this.currentIncident();
        if (!currBefore || currBefore.id !== payload.incidentId) {
          this.hydrateMissedIncidentFromSse(payload.incidentId, baseUrl);
          return;
        }
        this.currentIncident.update((curr) => {
          if (!curr || curr.id !== payload.incidentId) {
            return curr;
          }
          return {
            ...curr,
            notification: {
              emailId: payload.emailId,
              htmlPreview: payload.htmlPreview,
              status: payload.status
            }
          };
        });
      });

      es.addEventListener(IncidentEventType.DECISION, (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentDecisionEvent>(evt.data);
        if (!payload || this.dismissedIncidentIds.has(payload.incidentId)) {
          return;
        }
        this.clearVisualStateQueue();
        this.currentIncident.update((curr) => {
          if (!curr || curr.id !== payload.incidentId) {
            return curr;
          }
          return {
            ...curr,
            decision: payload.action,
            decisionSource: payload.source,
            state:
              payload.action === DecisionAction.APPROVE
                ? IncidentState.RESOLVED
                : IncidentState.REJECTED
          };
        });
      });
    } catch {
      this.sseConnected.set(false);
    }
  }

  /**
   * Closes the active SSE connection and clears pending client timers.
   */
  disconnectSse(): void {
    this.stopLiveWaitTimer();
    this.clearVisualStateQueue();
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

  /**
   * Fetches full details for a specific incident by ID.
   */
  async fetchIncident(id: string, baseUrl = ''): Promise<void> {
    if (this.dismissedIncidentIds.has(id)) {
      return;
    }
    const token = ++this.activeIncidentFetchToken;
    try {
      const res = await fetch(`${baseUrl}/api/incidents/${encodeURIComponent(id)}`);
      if (token !== this.activeIncidentFetchToken || this.dismissedIncidentIds.has(id)) {
        return;
      }
      if (res.ok) {
        const detail = (await res.json()) as IncidentDetail;
        if (token === this.activeIncidentFetchToken && !this.dismissedIncidentIds.has(id)) {
          this.currentIncident.set(detail);
          this.loadError.set(null);
        }
      } else {
        this.loadError.set(`Failed to fetch incident ${id}: HTTP ${res.status}`);
      }
    } catch (err) {
      if (token === this.activeIncidentFetchToken && !this.dismissedIncidentIds.has(id)) {
        this.loadError.set(toErrorMessage(err));
      }
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

  private buildDemoHeaders(includeJsonContentType = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (includeJsonContentType) {
      headers['Content-Type'] = 'application/json';
    }
    const key = this.liveDemoKey();
    if (isNonEmptyString(key)) {
      headers['X-Live-Demo-Key'] = key.trim();
    }
    return headers;
  }

  private async readErrorPayload(
    res: Response
  ): Promise<{ error: string; retryAfterSeconds?: number }> {
    try {
      const body = (await res.json()) as { error?: unknown; retryAfterSeconds?: unknown };
      const retryAfterSeconds = isNumber(body?.retryAfterSeconds)
        ? body.retryAfterSeconds
        : undefined;
      if (isNonEmptyString(body?.error)) {
        return {
          error: body.error,
          ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {})
        };
      }
      if (retryAfterSeconds !== undefined) {
        return { error: `HTTP ${res.status}`, retryAfterSeconds };
      }
    } catch {
      // Ignore non-JSON error payloads
    }
    return { error: `HTTP ${res.status}` };
  }

  /**
   * Triggers a chaos or replay simulation on the orchestrator demo API.
   */
  async triggerChaos(baseUrl = ''): Promise<DemoActionResult> {
    this.isSimulating.set(true);

    try {
      const mode = this.activeMode();
      const previousIncident = this.currentIncident();
      const res = await fetch(`${baseUrl}/api/demo/chaos`, {
        method: 'POST',
        headers: this.buildDemoHeaders(true),
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
      this.isSimulating.set(false);
    }
  }

  /**
   * Resets target service chaos state and refreshes incident and target signals.
   */
  async resetChaos(baseUrl = '', clearIncident = false): Promise<DemoActionResult> {
    this.isResetting.set(true);
    try {
      const res = await fetch(`${baseUrl}/api/demo/reset`, {
        method: 'POST',
        headers: this.buildDemoHeaders()
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

    const payload: SimulateDecisionPayload = {
      incidentId: incident.id,
      action
    };

    try {
      const res = await fetch(`${baseUrl}/api/demo/simulate-decision`, {
        method: 'POST',
        headers: this.buildDemoHeaders(true),
        body: JSON.stringify(payload)
      });

      if (res.ok) {
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

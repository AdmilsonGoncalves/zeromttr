import { Injectable, computed, signal } from '@angular/core';
import {
  isFilled,
  isNonEmptyArray,
  isNonEmptyString,
  percentage,
  round,
  safeJsonParse,
  toErrorMessage
} from '@zeromttr/utils';
import type {
  DecisionPayload,
  IncidentCreatedEvent,
  IncidentDecisionAction,
  IncidentDecisionEvent,
  IncidentDetail,
  IncidentDocsEvent,
  IncidentFinopsEvent,
  IncidentMode,
  IncidentNotifiedEvent,
  IncidentRcaEvent,
  IncidentRemediationEvent,
  IncidentState,
  IncidentTransitionEvent,
  ReasoningSource,
  SimulateDecisionPayload,
  TargetStatusResponse
} from './contract.js';
import type { TranslationDictionary } from './i18n.service.js';

export interface TimelineStepItem {
  id: number;
  titleKey: keyof TranslationDictionary;
  descKey: keyof TranslationDictionary;
  status: 'completed' | 'in-progress' | 'pending';
  icon: string;
  badge?: string;
  badgeSeverity?: 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast';
}

@Injectable({
  providedIn: 'root'
})
export class IncidentService {
  private eventSource: EventSource | null = null;

  readonly currentIncident = signal<IncidentDetail | null>(null);
  readonly targetStatus = signal<TargetStatusResponse | null>(null);
  readonly sseConnected = signal<boolean>(false);
  readonly activeMode = signal<IncidentMode>('replay');
  readonly liveDemoKey = signal<string>('');
  readonly isSimulating = signal<boolean>(false);
  readonly decisionStatus = signal<'idle' | 'loading' | 'success' | 'error'>('idle');
  readonly loadError = signal<string | null>(null);

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
    if (!rca) {
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
    if (typeof sec === 'number') {
      return `${sec}s`;
    }
    return '--';
  });

  readonly ttprDisplay = computed<string>(() => {
    const incident = this.currentIncident();
    if (!incident) {
      return '--';
    }
    const started = incident.startedAt ? new Date(incident.startedAt).getTime() : null;
    const prTransition = incident.transitions?.find(
      (t) => t.to === 'AWAITING_PR' || t.to === 'NOTIFIED'
    );
    if (started && prTransition) {
      const prTime = new Date(prTransition.at).getTime();
      const diffSec = ((prTime - started) / 1000).toFixed(1);
      return `${diffSec}s`;
    }
    return '--';
  });

  readonly leakedPatternsCount = computed<number>(() => {
    return this.currentIncident()?.rca?.piiGuardAudit.leakedPatternsDetected ?? 0;
  });

  readonly timelineSteps = computed<TimelineStepItem[]>(() => {
    const incident = this.currentIncident();
    const state: IncidentState = incident?.state ?? 'RECEIVED';
    const rca = incident?.rca;

    const isDone = (targetStates: IncidentState[]): boolean => {
      return targetStates.includes(state);
    };

    const isCurrent = (targetState: IncidentState): boolean => {
      return state === targetState;
    };

    const steps: TimelineStepItem[] = [
      {
        id: 1,
        titleKey: 'step1Title',
        descKey: 'step1Desc',
        status: isDone([
          'RECEIVED',
          'INVESTIGATING',
          'ENRICHING',
          'REMEDIATING',
          'AWAITING_PR',
          'NOTIFIED',
          'RESOLVED',
          'REJECTED'
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
          'INVESTIGATING',
          'ENRICHING',
          'REMEDIATING',
          'AWAITING_PR',
          'NOTIFIED',
          'RESOLVED',
          'REJECTED'
        ])
          ? 'completed'
          : isCurrent('RECEIVED')
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
          'ENRICHING',
          'REMEDIATING',
          'AWAITING_PR',
          'NOTIFIED',
          'RESOLVED',
          'REJECTED'
        ])
          ? 'completed'
          : isCurrent('INVESTIGATING')
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
          'ENRICHING',
          'REMEDIATING',
          'AWAITING_PR',
          'NOTIFIED',
          'RESOLVED',
          'REJECTED'
        ])
          ? 'completed'
          : isCurrent('INVESTIGATING')
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
          'ENRICHING',
          'REMEDIATING',
          'AWAITING_PR',
          'NOTIFIED',
          'RESOLVED',
          'REJECTED'
        ])
          ? 'completed'
          : isCurrent('INVESTIGATING')
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
        status: isDone(['REMEDIATING', 'AWAITING_PR', 'NOTIFIED', 'RESOLVED', 'REJECTED'])
          ? 'completed'
          : isCurrent('ENRICHING')
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
        status: isDone(['AWAITING_PR', 'NOTIFIED', 'RESOLVED', 'REJECTED'])
          ? 'completed'
          : isCurrent('REMEDIATING')
            ? 'in-progress'
            : 'pending',
        icon: 'pi pi-code',
        badge: rca?.reasoningSource === 'llm' ? 'Gemini LLM' : 'Fallback',
        badgeSeverity: 'info'
      },
      {
        id: 8,
        titleKey: 'step8Title',
        descKey: 'step8Desc',
        status: isDone(['NOTIFIED', 'RESOLVED', 'REJECTED'])
          ? 'completed'
          : isCurrent('AWAITING_PR')
            ? 'in-progress'
            : 'pending',
        icon: 'pi pi-envelope',
        badge: 'Resend HMAC in #fragment',
        badgeSeverity: 'contrast'
      }
    ];

    return steps;
  });

  setActiveMode(mode: IncidentMode): void {
    this.activeMode.set(mode);
  }

  setLiveDemoKey(key: string): void {
    this.liveDemoKey.set(key);
  }

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

      es.addEventListener('incident.created', (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentCreatedEvent>(evt.data);
        if (!payload) {
          return;
        }
        const current = this.currentIncident();
        if (!current || current.id !== payload.incidentId) {
          this.currentIncident.set({
            id: payload.incidentId,
            service: payload.service,
            severity: payload.severity,
            state: 'RECEIVED',
            mode: payload.mode,
            startedAt: payload.at,
            transitions: [{ from: null, to: 'RECEIVED', at: payload.at }]
          });
        }
      });

      es.addEventListener('incident.transition', (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentTransitionEvent>(evt.data);
        if (!payload) {
          return;
        }
        this.currentIncident.update((curr) => {
          if (!curr) {
            return null;
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
      });

      es.addEventListener('incident.rca', (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentRcaEvent>(evt.data);
        if (!payload) {
          return;
        }
        this.currentIncident.update((curr) => {
          if (!curr) {
            return null;
          }
          return {
            ...curr,
            rca: payload
          };
        });
      });

      es.addEventListener('incident.finops', (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentFinopsEvent>(evt.data);
        if (!payload) {
          return;
        }
        this.currentIncident.update((curr) => {
          if (!curr) {
            return null;
          }
          return {
            ...curr,
            finops: payload
          };
        });
      });

      es.addEventListener('incident.docs', (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentDocsEvent>(evt.data);
        if (!payload) {
          return;
        }
        this.currentIncident.update((curr) => {
          if (!curr) {
            return null;
          }
          return {
            ...curr,
            docs: payload.sources
          };
        });
      });

      es.addEventListener('incident.remediation', (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentRemediationEvent>(evt.data);
        if (!payload) {
          return;
        }
        this.currentIncident.update((curr) => {
          if (!curr) {
            return null;
          }
          return {
            ...curr,
            remediation: {
              branchUrl: payload.branchUrl,
              pullRequestUrl: payload.pullRequestUrl,
              commitSha: payload.commitSha
            }
          };
        });
      });

      es.addEventListener('incident.notified', (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentNotifiedEvent>(evt.data);
        if (!payload) {
          return;
        }
        this.currentIncident.update((curr) => {
          if (!curr) {
            return null;
          }
          return {
            ...curr,
            notification: {
              emailId: payload.emailId,
              htmlPreview: payload.htmlPreview
            }
          };
        });
      });

      es.addEventListener('incident.decision', (evt: MessageEvent) => {
        const payload = safeJsonParse<IncidentDecisionEvent>(evt.data);
        if (!payload) {
          return;
        }
        this.currentIncident.update((curr) => {
          if (!curr) {
            return null;
          }
          return {
            ...curr,
            decision: payload.action,
            decisionSource: payload.source,
            state: payload.action === 'approve' ? 'RESOLVED' : 'REJECTED'
          };
        });
      });
    } catch {
      this.sseConnected.set(false);
    }
  }

  disconnectSse(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.sseConnected.set(false);
  }

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

  async fetchIncident(id: string, baseUrl = ''): Promise<void> {
    try {
      const res = await fetch(`${baseUrl}/api/incidents/${encodeURIComponent(id)}`);
      if (res.ok) {
        const detail = (await res.json()) as IncidentDetail;
        this.currentIncident.set(detail);
        this.loadError.set(null);
      } else {
        this.loadError.set(`Failed to fetch incident ${id}: HTTP ${res.status}`);
      }
    } catch (err) {
      this.loadError.set(toErrorMessage(err));
    }
  }

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

  async triggerChaos(baseUrl = ''): Promise<void> {
    this.isSimulating.set(true);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    const key = this.liveDemoKey();
    if (isNonEmptyString(key)) {
      headers['X-Live-Demo-Key'] = key.trim();
    }

    try {
      await fetch(`${baseUrl}/api/demo/chaos`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode: this.activeMode() })
      });
      await this.fetchTargetStatus(baseUrl);
    } finally {
      this.isSimulating.set(false);
    }
  }

  async resetChaos(baseUrl = ''): Promise<void> {
    this.isSimulating.set(true);
    try {
      await fetch(`${baseUrl}/api/demo/reset`, {
        method: 'POST'
      });
      await this.fetchTargetStatus(baseUrl);
      const current = this.currentIncident();
      if (current) {
        await this.fetchIncident(current.id, baseUrl);
      }
    } finally {
      this.isSimulating.set(false);
    }
  }

  async simulateDecision(action: IncidentDecisionAction, baseUrl = ''): Promise<void> {
    const incident = this.currentIncident();
    if (!incident) {
      return;
    }

    const payload: SimulateDecisionPayload = {
      incidentId: incident.id,
      action
    };

    const res = await fetch(`${baseUrl}/api/demo/simulate-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      this.currentIncident.update((curr) => {
        if (!curr) {
          return null;
        }
        return {
          ...curr,
          decision: action,
          decisionSource: 'demo_simulation',
          state: action === 'approve' ? 'RESOLVED' : 'REJECTED'
        };
      });
    }
  }

  async submitDecision(
    incidentId: string,
    payload: DecisionPayload,
    baseUrl = ''
  ): Promise<boolean> {
    this.decisionStatus.set('loading');
    try {
      const res = await fetch(
        `${baseUrl}/api/incidents/${encodeURIComponent(incidentId)}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );

      if (res.ok) {
        this.decisionStatus.set('success');
        return true;
      }
      this.decisionStatus.set('error');
      return false;
    } catch {
      this.decisionStatus.set('error');
      return false;
    }
  }
}

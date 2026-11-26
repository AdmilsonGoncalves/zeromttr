import { IncidentExecutionMode, TargetHealthStatus } from '../domain/incident-enums.js';
import type { Incident, IncidentMode } from '../domain/incident.js';
import type { TargetStatusPort } from '../ports/target-status.port.js';
import type { DemoControlPort } from './demo-control.port.js';
import type { ReplayRunner } from './replay-runner.js';

export interface LastChaosSnapshot {
  timestamp: number;
  mode: IncidentMode;
  generation: number;
}

export interface DemoSessionLifecycleOptions {
  passiveTarget?: boolean;
}

export interface DemoSessionLifecycle {
  runSerialized<T>(fn: () => Promise<T>): Promise<T>;

  getLastChaosTimestamp(): number;

  getLastChaosMode(): IncidentMode;

  getLastChaosSnapshot(): LastChaosSnapshot;

  setLastChaos(timestamp: number, mode: IncidentMode): void;

  setProvisionalLastChaos(timestamp: number, mode: IncidentMode): void;

  commitLastChaos(): void;

  restoreLastChaos(snapshot: LastChaosSnapshot): void;

  clearLastChaos(): void;

  canResetTarget(): Promise<boolean>;

  hasPendingTargetReset(incidentId: string): boolean;

  clearPendingTargetResets(): void;

  markPendingLiveReset(): void;

  hasPendingLiveReset(): boolean;

  clearPendingLiveReset(): void;

  completeApprovalReset(incidentId: string): Promise<void>;

  handleLiveIncidentApproved(incident: Incident): Promise<void>;
}

/**
 * Creates a serialized demo session coordinator shared between demo routes and the post-approval hook.
 */
export function createDemoSessionLifecycle(
  demoControlPort: DemoControlPort,
  replayRunner?: ReplayRunner,
  targetStatusPort?: TargetStatusPort,
  options: DemoSessionLifecycleOptions = {}
): DemoSessionLifecycle {
  let lastChaosTimestamp = 0;
  let lastChaosMode: IncidentMode = IncidentExecutionMode.REPLAY;
  let chaosSessionGeneration = 0;
  let pendingLiveReset = false;
  const pendingTargetResetIncidentIds = new Set<string>();
  let lifecycleQueue: Promise<void> = Promise.resolve();

  const runSerialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = lifecycleQueue.then(fn, fn);
    lifecycleQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  const canResetTarget = async (): Promise<boolean> => {
    if (options.passiveTarget) {
      return false;
    }
    if (!targetStatusPort) {
      return true;
    }
    const targetStatus = await targetStatusPort.getStatus();
    if (
      targetStatus.status !== TargetHealthStatus.UNREACHABLE &&
      targetStatus.capabilities?.chaosSimulation === false
    ) {
      return false;
    }
    return true;
  };

  const completeApprovalReset = async (
    incidentId: string,
    resetOptions?: { skipCapabilityCheck?: boolean }
  ): Promise<void> => {
    pendingTargetResetIncidentIds.add(incidentId);
    replayRunner?.stop();
    const shouldResetTarget = resetOptions?.skipCapabilityCheck ? true : await canResetTarget();
    if (shouldResetTarget) {
      await demoControlPort.reset();
    }
    lastChaosTimestamp = 0;
    lastChaosMode = IncidentExecutionMode.REPLAY;
    pendingLiveReset = false;
    pendingTargetResetIncidentIds.delete(incidentId);
  };

  return {
    runSerialized,
    getLastChaosTimestamp: () => lastChaosTimestamp,
    getLastChaosMode: () => lastChaosMode,
    getLastChaosSnapshot: () => ({
      timestamp: lastChaosTimestamp,
      mode: lastChaosMode,
      generation: chaosSessionGeneration
    }),
    setLastChaos: (timestamp: number, mode: IncidentMode) => {
      lastChaosTimestamp = timestamp;
      lastChaosMode = mode;
      chaosSessionGeneration += 1;
    },
    setProvisionalLastChaos: (timestamp: number, mode: IncidentMode) => {
      lastChaosTimestamp = timestamp;
      lastChaosMode = mode;
    },
    commitLastChaos: () => {
      chaosSessionGeneration += 1;
    },
    restoreLastChaos: (snapshot: LastChaosSnapshot) => {
      lastChaosTimestamp = snapshot.timestamp;
      lastChaosMode = snapshot.mode;
    },
    clearLastChaos: () => {
      lastChaosTimestamp = 0;
      lastChaosMode = IncidentExecutionMode.REPLAY;
    },
    canResetTarget,
    hasPendingTargetReset: (incidentId: string) => pendingTargetResetIncidentIds.has(incidentId),
    clearPendingTargetResets: () => {
      pendingTargetResetIncidentIds.clear();
    },
    markPendingLiveReset: () => {
      pendingLiveReset = true;
    },
    hasPendingLiveReset: () => pendingLiveReset,
    clearPendingLiveReset: () => {
      pendingLiveReset = false;
    },
    completeApprovalReset,
    handleLiveIncidentApproved: async (incident: Incident): Promise<void> => {
      if (incident.mode !== IncidentExecutionMode.LIVE) {
        return;
      }
      const observedGeneration = chaosSessionGeneration;
      const incidentStartedAtMs = Date.parse(incident.startedAt);

      const shouldResetTarget = await canResetTarget();
      if (!shouldResetTarget) {
        return;
      }

      await runSerialized(async () => {
        const newerChaosStartedDuringLookup = chaosSessionGeneration !== observedGeneration;
        const newerSessionOwnsDemo =
          lastChaosTimestamp > 0 &&
          Number.isFinite(incidentStartedAtMs) &&
          lastChaosTimestamp > incidentStartedAtMs;
        if (newerChaosStartedDuringLookup || newerSessionOwnsDemo) {
          return;
        }
        pendingLiveReset = true;
        await completeApprovalReset(incident.id, { skipCapabilityCheck: true });
      });
    }
  };
}

import { isNonEmptyString } from '@zeromttr/utils';
import { OrchestratorDefault } from './incident-enums.js';

export interface AlertLabels {
  alertname?: string;
  service?: string;
  [key: string]: unknown;
}

/**
 * Computes a stable `alertname:service` deduplication fingerprint from Grafana alert labels.
 */
export function computeAlertFingerprint(labels: AlertLabels): string {
  const alertName = isNonEmptyString(labels.alertname)
    ? labels.alertname
    : OrchestratorDefault.UNKNOWN_ALERT;
  const service = isNonEmptyString(labels.service)
    ? labels.service
    : OrchestratorDefault.UNKNOWN_SERVICE;
  return `${alertName}:${service}`;
}

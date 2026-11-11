import { isNonEmptyString } from '@zeromttr/utils';

export interface AlertLabels {
  alertname?: string;
  service?: string;
  [key: string]: unknown;
}

export function computeAlertFingerprint(labels: AlertLabels): string {
  const alertName = isNonEmptyString(labels.alertname) ? labels.alertname : 'unknown-alert';
  const service = isNonEmptyString(labels.service) ? labels.service : 'unknown-service';
  return `${alertName}:${service}`;
}

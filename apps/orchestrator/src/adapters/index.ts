import type { IncidentPort } from '../ports/index.js';

export class BaseIncidentAdapter implements IncidentPort {
  async notify(): Promise<void> {
    return Promise.resolve();
  }
}

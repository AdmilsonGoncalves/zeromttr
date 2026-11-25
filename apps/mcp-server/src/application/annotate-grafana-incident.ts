import { isArray, isNonEmptyString, unique } from '@zeromttr/utils';
import type {
  AnnotationPort,
  AnnotationRequest,
  AnnotationReceipt
} from '../ports/annotation.port.js';

/**
 * MCP use case creating tagged Grafana incident annotations through the annotation port.
 */
export class AnnotateGrafanaIncident {
  constructor(private readonly annotationPort: AnnotationPort) {}

  /**
   * Validates annotation text, attaches the remediation tag, and creates the Grafana annotation.
   */
  async execute(input: AnnotationRequest): Promise<AnnotationReceipt> {
    if (!isNonEmptyString(input.text)) {
      throw new Error('Annotation text must not be empty.');
    }

    const tags = unique([...(isArray(input.tags) ? input.tags : []), 'aiops-remediation']);

    return this.annotationPort.createAnnotation({
      ...input,
      tags
    });
  }
}

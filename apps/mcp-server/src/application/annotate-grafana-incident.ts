import { isArray, isNonEmptyString, unique } from '@zeromttr/utils';
import type {
  AnnotationPort,
  AnnotationRequest,
  AnnotationReceipt
} from '../ports/annotation.port.js';

export class AnnotateGrafanaIncident {
  constructor(private readonly annotationPort: AnnotationPort) {}

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

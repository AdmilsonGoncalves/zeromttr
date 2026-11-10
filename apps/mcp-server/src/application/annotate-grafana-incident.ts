import type { AnnotationPort, AnnotationRequest, AnnotationReceipt } from '../ports/index.js';

export class AnnotateGrafanaIncident {
  constructor(private readonly annotationPort: AnnotationPort) {}

  async execute(input: AnnotationRequest): Promise<AnnotationReceipt> {
    if (!input.text || !input.text.trim()) {
      throw new Error('Annotation text must not be empty.');
    }

    const tags = Array.isArray(input.tags) ? [...input.tags] : [];
    if (!tags.includes('aiops-remediation')) {
      tags.push('aiops-remediation');
    }

    return this.annotationPort.createAnnotation({
      ...input,
      tags
    });
  }
}

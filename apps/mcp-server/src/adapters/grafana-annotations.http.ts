import type {
  AnnotationPort,
  AnnotationRequest,
  AnnotationReceipt
} from '../ports/annotation.port.js';

export interface GrafanaAnnotationsConfig {
  baseUrl: string;
  apiToken?: string;
}

export class GrafanaAnnotationsHttpAdapter implements AnnotationPort {
  private readonly baseUrl: string;

  constructor(private readonly config: GrafanaAnnotationsConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (this.config.apiToken) {
      headers.Authorization = `Bearer ${this.config.apiToken}`;
    }
    return headers;
  }

  async createAnnotation(req: AnnotationRequest): Promise<AnnotationReceipt> {
    const url = `${this.baseUrl}/api/annotations`;
    const tags = Array.from(new Set([...(req.tags || []), 'aiops-remediation']));

    let text = req.text;
    if (req.pull_request_url) {
      text += `\nPR: ${req.pull_request_url}`;
    }

    const payload = {
      time: req.time || Date.now(),
      text,
      tags
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Grafana createAnnotation failed: ${response.status} ${errText}`);
    }

    const data = (await response.json()) as { id?: number; message?: string };
    return {
      id: data.id || Date.now(),
      message: data.message || 'Annotation added'
    };
  }
}

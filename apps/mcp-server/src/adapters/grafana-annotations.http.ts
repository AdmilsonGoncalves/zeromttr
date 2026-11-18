import { isNonEmptyString, unique } from '@zeromttr/utils';
import {
  buildUrl,
  isHttpSuccess,
  sanitizeHeaderValue,
  trimTrailingSlash
} from '@zeromttr/utils/http';
import type { AnnotationPort, AnnotationRequest, AnnotationReceipt } from '../ports/index.js';

export interface GrafanaAnnotationsConfig {
  baseUrl: string;
  apiToken?: string;
}

export class GrafanaAnnotationsHttpAdapter implements AnnotationPort {
  private readonly baseUrl: string;

  constructor(private readonly config: GrafanaAnnotationsConfig) {
    this.baseUrl = trimTrailingSlash(config.baseUrl);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (isNonEmptyString(this.config.apiToken)) {
      headers.Authorization = `Bearer ${sanitizeHeaderValue(this.config.apiToken)}`;
    }
    return headers;
  }

  async createAnnotation(req: AnnotationRequest): Promise<AnnotationReceipt> {
    const url = buildUrl(this.baseUrl, '/api/annotations');
    const tags = unique([...(req.tags || []), 'aiops-remediation']);

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

    if (!isHttpSuccess(response.status)) {
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

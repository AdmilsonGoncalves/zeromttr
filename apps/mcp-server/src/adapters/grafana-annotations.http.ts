import { isNonEmptyString, unique } from '@zeromttr/utils';
import {
  CONTENT_TYPE,
  HTTP_HEADERS,
  buildUrl,
  isHttpSuccess,
  sanitizeHeaderValue,
  trimTrailingSlash
} from '@zeromttr/utils/http';
import type {
  AnnotationPort,
  AnnotationRequest,
  AnnotationReceipt
} from '../ports/annotation.port.js';

export interface GrafanaAnnotationsConfig {
  baseUrl: string;
  apiToken?: string;
  basicAuth?: {
    username: string;
    password: string;
  };
}

/**
 * Grafana HTTP adapter publishing incident timeline annotations using Bearer token or local Basic auth.
 */
export class GrafanaAnnotationsHttpAdapter implements AnnotationPort {
  private readonly baseUrl: string;

  constructor(private readonly config: GrafanaAnnotationsConfig) {
    this.baseUrl = trimTrailingSlash(config.baseUrl);
  }

  private assertSafeBasicAuthTransport(): void {
    let parsed: URL;
    try {
      parsed = new URL(this.baseUrl);
    } catch {
      throw new Error(`Invalid Grafana baseUrl for Basic auth: '${this.baseUrl}'`);
    }
    if (parsed.protocol === 'https:') {
      return;
    }
    const localHosts = new Set([
      'localhost',
      '127.0.0.1',
      '::1',
      '[::1]',
      'grafana',
      'zeromttr-grafana'
    ]);
    if (parsed.protocol === 'http:' && localHosts.has(parsed.hostname.toLowerCase())) {
      return;
    }
    throw new Error(
      `Refusing to send Grafana Basic credentials over insecure HTTP host '${parsed.hostname}'`
    );
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      [HTTP_HEADERS.CONTENT_TYPE]: CONTENT_TYPE.JSON,
      [HTTP_HEADERS.ACCEPT]: CONTENT_TYPE.JSON
    };
    if (isNonEmptyString(this.config.apiToken)) {
      headers[HTTP_HEADERS.AUTHORIZATION] = `Bearer ${sanitizeHeaderValue(this.config.apiToken)}`;
    } else if (
      this.config.basicAuth &&
      isNonEmptyString(this.config.basicAuth.username) &&
      isNonEmptyString(this.config.basicAuth.password)
    ) {
      this.assertSafeBasicAuthTransport();
      const encoded = Buffer.from(
        `${this.config.basicAuth.username}:${this.config.basicAuth.password}`,
        'utf-8'
      ).toString('base64');
      headers[HTTP_HEADERS.AUTHORIZATION] = `Basic ${encoded}`;
    }
    return headers;
  }

  /**
   * Posts an incident timeline annotation with remediation tags to the Grafana HTTP API.
   */
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

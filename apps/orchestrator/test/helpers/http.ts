import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { safeJsonParse } from '@zeromttr/utils';

export interface HttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export async function makeRequest(server: http.Server, path: string): Promise<HttpResponse> {
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}${path}`;
  const response = await fetch(url);
  const text = await response.text();
  const body = safeJsonParse(text, text);
  return {
    status: response.status,
    body,
    headers: Object.fromEntries(response.headers.entries())
  };
}

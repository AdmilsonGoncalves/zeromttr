import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { bootstrap } from '../../src/main.js';

export interface HttpResponse<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function makeRequest<T = unknown>(
  server: http.Server,
  path: string,
  options: RequestOptions = {}
): Promise<HttpResponse<T>> {
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}${path}`;

  const fetchOptions: RequestInit = {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  };

  if (options.body) {
    fetchOptions.body =
      typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);
  const text = await response.text();
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    parsedBody = text;
  }

  return {
    status: response.status,
    body: parsedBody as T,
    headers: Object.fromEntries(response.headers.entries())
  };
}

export async function createTestServer(): Promise<{
  server: http.Server;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = bootstrap(0);
    server.once('error', reject);
    server.on('listening', () => {
      server.off('error', reject);
      resolve({
        server,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          })
      });
    });
  });
}

export async function postPayment(
  server: http.Server,
  payload: unknown,
  headers?: Record<string, string>
) {
  return makeRequest(server, '/payments', {
    method: 'POST',
    body: payload,
    headers
  });
}

export async function getPayment(
  server: http.Server,
  paymentId: string,
  headers?: Record<string, string>
) {
  return makeRequest(server, `/payments/${paymentId}`, {
    method: 'GET',
    headers
  });
}

export async function toggleChaos(server: http.Server, enable: boolean) {
  return makeRequest(server, `/chaos/pool-saturation?enable=${enable}`, {
    method: 'POST'
  });
}

export async function getChaosStatus(server: http.Server) {
  return makeRequest(server, '/chaos/status', {
    method: 'GET'
  });
}

export async function getHealth(server: http.Server) {
  return makeRequest(server, '/health', {
    method: 'GET'
  });
}

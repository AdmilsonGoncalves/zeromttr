import type http from 'node:http';
import { isObject, safeJsonParse } from '@zeromttr/utils';

export interface HttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface CapturedSseEvent {
  event: string;
  data: unknown;
}

export async function makeRequest(server: http.Server, path: string): Promise<HttpResponse> {
  const address = server.address();
  if (!address || !isObject(address) || typeof address.port !== 'number') {
    throw new Error('Server is not listening on an ephemeral TCP port');
  }
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

/**
 * Connects to an SSE stream on the ephemeral server and collects non-heartbeat events
 * until `stopPredicate` returns true or `signal` aborts.
 */
export async function collectSseEventsUntil(
  server: http.Server,
  path: string,
  headers: Record<string, string>,
  stopPredicate: (events: CapturedSseEvent[]) => boolean,
  timeoutMs = 2000
): Promise<CapturedSseEvent[]> {
  const address = server.address();
  if (!address || !isObject(address) || typeof address.port !== 'number') {
    throw new Error('Server is not listening on an ephemeral TCP port');
  }

  const events: CapturedSseEvent[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers,
      signal: controller.signal
    });
    const reader = response.body?.getReader();
    if (!reader) {
      return events;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const lines = chunk.split('\n');
        const eventLine = lines.find((line) => line.startsWith('event: '));
        const dataLine = lines.find((line) => line.startsWith('data: '));
        if (!eventLine) {
          continue;
        }
        const eventName = eventLine.slice('event: '.length).trim();
        if (eventName === 'heartbeat') {
          continue;
        }
        const rawData = dataLine ? dataLine.slice('data: '.length).trim() : '';
        events.push({
          event: eventName,
          data: safeJsonParse(rawData, rawData)
        });
        if (stopPredicate(events)) {
          controller.abort();
          return events;
        }
      }
    }
  } catch {
    // Expected when AbortController closes stream
  } finally {
    clearTimeout(timer);
  }

  return events;
}

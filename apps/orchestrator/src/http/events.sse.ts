import type { Request, Response } from 'express';
import { nowIso } from '@zeromttr/utils';
import type { EventBroadcasterPort } from '../ports/index.js';

export class SseEventBroadcaster implements EventBroadcasterPort {
  private readonly clients = new Set<Response>();
  private readonly heartbeatTimer: NodeJS.Timeout;

  public constructor(heartbeatIntervalMs = 15_000) {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  public handleConnection(req: Request, res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    this.clients.add(res);

    // Initial heartbeat
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`);

    const cleanup = (): void => {
      this.clients.delete(res);
    };

    req.once('close', cleanup);
    res.once('close', cleanup);
    res.once('error', cleanup);
  }

  public broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private sendHeartbeat(): void {
    const payload = `event: heartbeat\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  public close(): void {
    clearInterval(this.heartbeatTimer);
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // Ignore
      }
    }
    this.clients.clear();
  }

  public getActiveClientsCount(): number {
    return this.clients.size;
  }
}

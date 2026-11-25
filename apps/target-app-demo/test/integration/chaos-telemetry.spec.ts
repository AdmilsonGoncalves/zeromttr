import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { chaosController } from '../../src/controllers/chaos.controller.js';
import { requestMetrics } from '../../src/telemetry/request-metrics.js';

function requestJson(
  server: http.Server,
  method: 'GET' | 'POST',
  path: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Server address unavailable'));
      return;
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(data) as Record<string, unknown>
          });
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

describe('Target App Chaos Telemetry & Healthy Traffic Routes', () => {
  let server: http.Server | null = null;
  let originalPort: string | undefined;

  afterEach(async () => {
    chaosController.stopHealthyTraffic();
    requestMetrics.reset();
    if (originalPort !== undefined) {
      process.env.PORT = originalPort;
    } else {
      delete process.env.PORT;
    }
    originalPort = undefined;
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
  });

  it('should_expose_live_metrics_and_toggle_healthy_traffic_on_chaos_routes', async () => {
    originalPort = process.env.PORT;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server address unavailable');
    }
    process.env.PORT = String(address.port);

    const initialStatus = await requestJson(server, 'GET', '/chaos/status');
    expect(initialStatus.status).toBe(200);
    expect(initialStatus.body.metrics).toMatchObject({
      requestsPerSecond: 0,
      errorRate5xxPercent: 0,
      p95LatencyMs: 0,
      healthyTrafficActive: false
    });

    const enableRes = await requestJson(server, 'POST', '/chaos/healthy-traffic?enable=true');
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.healthyTrafficActive).toBe(true);
    expect(
      (enableRes.body.status as { metrics: { healthyTrafficActive: boolean } }).metrics
        .healthyTrafficActive
    ).toBe(true);

    let measuredRps = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const statusRes = await requestJson(server, 'GET', '/chaos/status');
      const metrics = statusRes.body.metrics as { requestsPerSecond: number };
      if (metrics.requestsPerSecond > 0) {
        measuredRps = metrics.requestsPerSecond;
        break;
      }
    }
    expect(measuredRps).toBeGreaterThan(0);

    const disableRes = await requestJson(server, 'POST', '/chaos/healthy-traffic?enable=false');
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.healthyTrafficActive).toBe(false);
  });
});

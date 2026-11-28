import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { startServer } from '../../src/server.js';
import { chaosController } from '../../src/controllers/chaos.controller.js';
import { chaosManager } from '../../src/chaos/chaos.manager.js';
import { paymentRepository } from '../../src/repositories/payment.repository.js';
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
    vi.restoreAllMocks();
    chaosController.stopHealthyTraffic();
    chaosManager.reset();
    paymentRepository.resetPool();
    requestMetrics.reset();
    delete process.env.CHAOS_AUTO_TRAFFIC_BURST;
    delete process.env.DEMO_MODE;
    delete process.env.HEALTHY_TRAFFIC_AUTO_START;
    delete process.env.HEALTHY_TRAFFIC_INTERVAL_MS;
    delete process.env.CHAOS_ENDPOINTS_ENABLED;
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

  it('should trigger synthetic burst only when CHAOS_AUTO_TRAFFIC_BURST is true', async () => {
    originalPort = process.env.PORT;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server address unavailable');
    }
    process.env.PORT = String(address.port);

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 500 }));

    // 1. Disabled when both flags are unset or false
    process.env.CHAOS_AUTO_TRAFFIC_BURST = 'false';
    process.env.DEMO_MODE = 'true';
    await requestJson(server, 'POST', '/chaos/pool-saturation?enable=true');
    expect(fetchSpy).not.toHaveBeenCalled();
    await requestJson(server, 'POST', '/chaos/pool-saturation?enable=false');

    // 2. Enabled when CHAOS_AUTO_TRAFFIC_BURST=true
    process.env.CHAOS_AUTO_TRAFFIC_BURST = 'true';
    delete process.env.DEMO_MODE;
    await requestJson(server, 'POST', '/chaos/pool-saturation?enable=true');
    expect(fetchSpy).toHaveBeenCalledTimes(6);
    await requestJson(server, 'POST', '/chaos/pool-saturation?enable=false');

    // 3. Legacy fallback when CHAOS_AUTO_TRAFFIC_BURST is unset and DEMO_MODE=true
    fetchSpy.mockClear();
    delete process.env.CHAOS_AUTO_TRAFFIC_BURST;
    process.env.DEMO_MODE = 'true';
    await requestJson(server, 'POST', '/chaos/pool-saturation?enable=true');
    expect(fetchSpy).toHaveBeenCalledTimes(6);
    await requestJson(server, 'POST', '/chaos/pool-saturation?enable=false');
  });

  it('should_auto_start_healthy_traffic_on_boot_with_configurable_interval_when_enabled', async () => {
    process.env.HEALTHY_TRAFFIC_AUTO_START = 'true';
    process.env.HEALTHY_TRAFFIC_INTERVAL_MS = '3000';
    process.env.CHAOS_ENDPOINTS_ENABLED = 'true';

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    server = startServer(0);
    await new Promise<void>((resolve) => {
      server?.once('listening', resolve);
    });

    expect(chaosController.isHealthyTrafficActive()).toBe(true);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3000);

    const statusRes = await requestJson(server, 'GET', '/chaos/status');
    expect(statusRes.status).toBe(200);
    expect((statusRes.body.metrics as { healthyTrafficActive: boolean }).healthyTrafficActive).toBe(
      true
    );
  });

  it('should_not_auto_start_healthy_traffic_when_chaos_endpoints_are_disabled', async () => {
    process.env.HEALTHY_TRAFFIC_AUTO_START = 'true';
    process.env.CHAOS_ENDPOINTS_ENABLED = 'false';

    server = startServer(0);
    await new Promise<void>((resolve) => {
      server?.once('listening', resolve);
    });

    expect(chaosController.isHealthyTrafficActive()).toBe(false);
  });
});

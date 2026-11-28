import http from 'node:http';
import { parseNumber } from '@zeromttr/utils';
import { createApp } from './app.js';
import { chaosController } from './controllers/chaos.controller.js';
import { areChaosEndpointsEnabled } from './controllers/ops-status.controller.js';

const defaultPort = parseNumber(process.env.PORT, 3001);

function isHealthyTrafficAutoStartEnabled(): boolean {
  return (process.env.HEALTHY_TRAFFIC_AUTO_START ?? '').trim().toLowerCase() === 'true';
}

/**
 * Creates the target app HTTP server and binds it to the specified port.
 */
export function startServer(port: number = defaultPort): http.Server {
  const handler = createApp();
  const server = http.createServer(handler);

  server.on('close', () => {
    chaosController.stopHealthyTraffic();
  });

  server.listen(port, () => {
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : port;
    chaosController.setBoundPort(boundPort);
    if (areChaosEndpointsEnabled() && isHealthyTrafficAutoStartEnabled()) {
      chaosController.startHealthyTraffic(boundPort);
    }
    console.log(`[target-app-demo] api-pagamentos-core listening on port ${boundPort}`);
  });

  return server;
}

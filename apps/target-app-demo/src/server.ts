import http from 'node:http';
import { parseNumber } from '@zeromttr/utils';
import { createApp } from './app.js';

const defaultPort = parseNumber(process.env.PORT, 3001);

/**
 * Creates the target app HTTP server and binds it to the specified port.
 */
export function startServer(port: number = defaultPort): http.Server {
  const handler = createApp();
  const server = http.createServer(handler);

  server.listen(port, () => {
    console.log(`[target-app-demo] api-pagamentos-core listening on port ${port}`);
  });

  return server;
}

import type http from 'node:http';
import { parseNumber } from '@zeromttr/utils';
import { createApp } from './app.js';
import { startServer } from './server.js';

export { createApp, startServer };

const defaultPort = parseNumber(process.env.PORT, 3001);

/**
 * Starts the `target-app-demo` HTTP server on the given port.
 */
export function bootstrap(port: number = defaultPort): http.Server {
  return startServer(port);
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

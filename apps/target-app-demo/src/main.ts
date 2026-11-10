import type http from 'node:http';
import { createApp } from './app.js';
import { startServer } from './server.js';

export { createApp, startServer };

const defaultPort =
  process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 3001;

export function bootstrap(port: number = defaultPort): http.Server {
  return startServer(port);
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap();
}

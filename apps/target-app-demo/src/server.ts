import http from 'node:http';
import { createApp } from './app.js';

const defaultPort =
  process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 3001;

export function startServer(port: number = defaultPort): http.Server {
  const handler = createApp();
  const server = http.createServer(handler);

  server.listen(port, () => {
    console.log(`[target-app-demo] api-pagamentos-core listening on port ${port}`);
  });

  return server;
}

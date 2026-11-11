import { createMockServer } from './server.js';

const port = Number(process.env['PORT'] ?? 8080);
const server = createMockServer({ port });

server
  .start()
  .then((boundPort) => {
    console.log(`[ZeroMTTR Mock Server] Running at http://localhost:${boundPort}`);
  })
  .catch((err: unknown) => {
    console.error('[ZeroMTTR Mock Server] Failed to start:', err);
    process.exit(1);
  });

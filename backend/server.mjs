import http from 'node:http';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

// No packages or external services are required by this stateless demo.
export function createApp({ instanceId = process.env.INSTANCE_ID || 'local', log = console.log } = {}) {
  let connectionNumber = 0;
  const connections = new WeakMap();
  const server = http.createServer((req, res) => {
    if (!connections.has(req.socket)) connections.set(req.socket, ++connectionNumber);
    const connectionId = `${instanceId}:${connections.get(req.socket)}`;
    const requestId = req.headers['x-request-id'] || null;
    const path = new URL(req.url, 'http://localhost').pathname;
    let status = 200;
    let body;

    if (!['GET', 'HEAD'].includes(req.method)) {
      status = 405;
      res.setHeader('Allow', 'GET, HEAD');
      body = { error: 'Method not allowed' };
    } else if (path === '/healthz') {
      body = { status: 'ok', instanceId, hostname: os.hostname() };
    } else if (path === '/' || path === '/api/whoami') {
      body = { instanceId, hostname: os.hostname(), timestamp: new Date().toISOString(), requestId };
    } else {
      status = 404;
      body = { error: 'Not found' };
    }

    const encoded = JSON.stringify(body) + '\n';
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(encoded),
      'Cache-Control': 'no-store',
      'X-Backend-Id': instanceId,
      'X-Backend-Connection': connectionId,
    });
    res.end(req.method === 'HEAD' ? undefined : encoded);
    log(JSON.stringify({ instanceId, method: req.method, path, status, requestId, connectionId }));
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  const server = createApp();
  server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', port })));
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

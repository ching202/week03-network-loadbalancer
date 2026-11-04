import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../backend/server.mjs';
import { requestJson, assertSuccessful, assertRoundRobin } from '../scripts/http.mjs';

async function withApp(instanceId, fn) {
  const server = createApp({ instanceId, log: () => {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await fn(url); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('Two actual backend servers return distinct IDs, healthy responses, and no-store', async () => {
  await withApp('Backend-1', async first => withApp('Backend-2', async second => {
    const a = await (await fetch(`${first}/api/whoami`)).json();
    const b = await (await fetch(`${second}/api/whoami`)).json();
    assert.equal(a.instanceId, 'Backend-1');
    assert.equal(b.instanceId, 'Backend-2');
    assert.ok(a.hostname && !Number.isNaN(Date.parse(a.timestamp)));
    const health = await fetch(`${first}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.equal((await health.json()).status, 'ok');
  }));
});

test('Request ID survives the application, and one TCP socket handles two requests', async () => {
  await withApp('Backend-1', async url => {
    const response = await fetch(`${url}/api/whoami`, { headers: { 'X-Request-Id': 'qa-123' } });
    assert.equal((await response.json()).requestId, 'qa-123');
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const a = await requestJson(`${url}/api/whoami`, agent);
      const b = await requestJson(`${url}/api/whoami`, agent);
      assertSuccessful([a, b], 'Backend-1');
      assert.equal(a.backendConnection, b.backendConnection);
      assert.equal(a.localPort, b.localPort);
    } finally { agent.destroy(); }
  });
});

test('Unsupported writes and unknown paths fail; HEAD has no body', async () => {
  await withApp('Backend-1', async url => {
    assert.equal((await fetch(`${url}/missing`)).status, 404);
    const write = await fetch(`${url}/api/whoami`, { method: 'POST', body: '{}' });
    assert.equal(write.status, 405);
    assert.equal(write.headers.get('allow'), 'GET, HEAD');
    const head = await fetch(`${url}/healthz`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.ok(Number(head.headers.get('content-length')) > 0);
  });
});

test('QA reports an actual refused connection as a failed request', async () => {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const result = await requestJson(`http://127.0.0.1:${port}/api/whoami`);
  assert.equal(result.ok, false);
  assert.match(result.error, /ECONNREFUSED/);
  assert.throws(() => assertSuccessful([result]));
});

test('QA rejects 502 responses and HTTP 200 with malformed JSON', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/bad-json' ? 200 : 502);
    res.end(req.url === '/bad-json' ? '<html>error</html>' : JSON.stringify({ instanceId: 'Backend-1' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const malformed = await requestJson(`${base}/bad-json`);
    assert.equal(malformed.ok, false);
    assert.equal(malformed.status, 200);
    assert.match(malformed.error, /Invalid JSON/);
    const badGateway = await requestJson(`${base}/bad-gateway`);
    assert.equal(badGateway.ok, false);
    assert.equal(badGateway.status, 502);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('QA rejects evenly counted but nonalternating traffic and missing measurements', () => {
  const make = instanceId => ({ ok: true, status: 200, instanceId });
  const alternating = Array.from({ length: 10 }, (_, i) => make(i % 2 ? 'Backend-2' : 'Backend-1'));
  assert.deepEqual(assertRoundRobin(alternating), { 'Backend-1': 5, 'Backend-2': 5 });
  const grouped = [...Array(5).fill(make('Backend-1')), ...Array(5).fill(make('Backend-2'))];
  assert.throws(() => assertRoundRobin(grouped), /did not alternate/);
  assert.throws(() => assertRoundRobin([]), /No requests/);
  assert.throws(() => assertSuccessful([make('unexpected')]));
});

import http from 'node:http';
import assert from 'node:assert/strict';

export const expectedIds = ['Backend-1', 'Backend-2'];

// Exactly one HTTP attempt. Failures are data, never retried by this client.
export function requestJson(url, agent) {
  const started = performance.now();
  return new Promise(resolve => {
    let finished = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ...result, elapsedMs: Math.round(performance.now() - started) });
    };
    const req = http.get(url, { agent }, response => {
      const localPort = response.socket.localPort;
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', error => finish({ ok: false, error: error.message }));
      response.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          finish({
            ok: response.statusCode === 200,
            status: response.statusCode,
            body,
            instanceId: body.instanceId,
            requestId: response.headers['x-request-id'],
            backendConnection: response.headers['x-backend-connection'],
            cacheControl: response.headers['cache-control'],
            localPort,
          });
        } catch (error) {
          finish({ ok: false, status: response.statusCode, error: `Invalid JSON: ${error.message}` });
        }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Request exceeded 8 seconds')), 8000);
    req.on('error', error => finish({ ok: false, error: error.message }));
  });
}

export function assertSuccessful(samples, expectedId) {
  assert.ok(samples.length > 0, 'No requests were measured');
  for (const [index, sample] of samples.entries()) {
    assert.equal(sample.ok, true, `Request ${index + 1} failed: ${sample.error || sample.status}`);
    assert.equal(sample.status, 200, `Request ${index + 1} did not return HTTP 200`);
    assert.ok(expectedIds.includes(sample.instanceId), `Unexpected backend: ${sample.instanceId}`);
    if (expectedId) assert.equal(sample.instanceId, expectedId, 'Request reached the stopped backend');
  }
}

export function assertRoundRobin(samples) {
  assertSuccessful(samples);
  assert.ok(samples.length >= 10, 'At least 10 sequential requests are required');
  const counts = Object.fromEntries(expectedIds.map(id => [id, samples.filter(r => r.instanceId === id).length]));
  assert.ok(Math.abs(counts['Backend-1'] - counts['Backend-2']) <= 1, `Uneven distribution: ${JSON.stringify(counts)}`);
  for (let i = 1; i < samples.length; i++) {
    assert.notEqual(samples[i].instanceId, samples[i - 1].instanceId, 'Sequential responses did not alternate; pause other API clients and rerun');
  }
  return counts;
}

import http from 'node:http';
import { requestJson, assertSuccessful } from './http.mjs';
const count = Number(process.argv[2] || 10);
const base = process.argv[3] || 'http://127.0.0.1:80';
if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('Count must be an integer from 1 to 10000');
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const samples = [];
try {
  for (let i = 0; i < count; i++) {
    const row = await requestJson(new URL('/api/whoami', base), agent);
    samples.push(row);
    console.log(`${String(i + 1).padStart(2)} | HTTP ${row.status || 'ERROR'} | ${row.instanceId || row.error} | ${row.elapsedMs} ms`);
  }
  assertSuccessful(samples);
  console.log(JSON.stringify({ requests: count, failures: 0, counts: Object.fromEntries(['Backend-1', 'Backend-2'].map(id => [id, samples.filter(row => row.instanceId === id).length])) }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { agent.destroy(); }

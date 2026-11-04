import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { requestJson, assertSuccessful, assertRoundRobin, expectedIds } from './http.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const exec = promisify(execFile);
const composeArgs = ['compose', '--project-directory', root, '-f', path.join(root, 'compose.yaml')];
const docker = async args => (await exec('docker', args, { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 8_000_000 })).stdout.trim();
const compose = (...args) => docker([...composeArgs, ...args]);
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const report = {
  startedAt: new Date().toISOString(), node: process.version, mode: 'docker-integration',
  status: 'RUNNING', checks: [], requests: [],
  manualBrowserChecks: 'PENDING: DevTools Console, Network headers, and screen/webcam recording',
};
let restoreBackend = false;
let base;

async function check(name, fn) {
  process.stdout.write(`\nCHECK: ${name}\n`);
  try {
    const detail = await fn();
    report.checks.push({ name, status: 'PASS', detail });
    console.log('PASS');
    return detail;
  } catch (error) {
    report.checks.push({ name, status: 'FAIL', error: error.message });
    throw error;
  }
}

async function sample(phase) {
  const outcome = await requestJson(`${base}/api/whoami`, agent);
  const row = { phase, number: report.requests.length + 1, ...outcome };
  report.requests.push(row);
  console.log(`${String(row.number).padStart(3)} ${phase}: ${row.status || 'ERROR'} ${row.instanceId || row.error || 'unknown'} (${row.elapsedMs} ms)`);
  return row;
}

async function series(phase, count) {
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(await sample(phase));
  return rows;
}

async function inspectService(service) {
  const id = await compose('ps', '-q', service);
  assert.ok(id && !/\s/.test(id), `Expected one running ${service} container; run docker compose up --build -d --wait`);
  return JSON.parse(await docker(['inspect', id]))[0];
}

async function waitHealthy(service) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const info = await inspectService(service);
    if (info.State.Health?.Status === 'healthy') return;
    await delay(500);
  }
  throw new Error(`${service} did not become healthy within 45 seconds`);
}

async function closedHostPort(port) {
  const result = await new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = state => { socket.destroy(); resolve(state); };
    socket.setTimeout(2000, () => finish('timeout'));
    socket.once('connect', () => finish('OPEN'));
    socket.once('error', error => finish(error.code));
  });
  assert.ok(['ECONNREFUSED', 'ETIMEDOUT', 'timeout'].includes(result), `Host port ${port}: ${result}. An unrelated listener can also cause this test to fail; inspect its owner.`);
  return { port, result };
}

try {
  console.log('Close other API clients. This test stops backend1, measures traffic, then restores it.');
  await docker(['version', '--format', '{{.Server.Version}}']);
  const config = JSON.parse(await compose('config', '--format', 'json'));
  const publicName = config.networks.public_subnet.name;
  const privateName = config.networks.private_subnet.name;
  const lbBefore = await inspectService('load-balancer');
  const backend1 = await inspectService('backend1');
  const backend2 = await inspectService('backend2');

  await check('Declared and actual network boundaries; no backend port publication', async () => {
    assert.deepEqual(Object.keys(config.services).sort(), ['backend1', 'backend2', 'load-balancer']);
    assert.equal(config.networks.private_subnet.internal, true);
    for (const [service, info] of [['backend1', backend1], ['backend2', backend2]]) {
      assert.equal(info.Config.Labels['com.docker.compose.project'], config.name);
      assert.deepEqual(Object.keys(config.services[service].networks), ['private_subnet']);
      assert.ok(!config.services[service].ports?.length, `${service} declares published ports`);
      assert.deepEqual(Object.keys(info.NetworkSettings.Networks), [privateName]);
      assert.ok(Object.values(info.HostConfig.PortBindings || {}).every(value => !value?.length), `${service} publishes ports at runtime`);
    }
    assert.deepEqual(Object.keys(lbBefore.NetworkSettings.Networks).sort(), [privateName, publicName].sort());
    const privateNetwork = JSON.parse(await docker(['network', 'inspect', privateName]))[0];
    const publicNetwork = JSON.parse(await docker(['network', 'inspect', publicName]))[0];
    assert.equal(privateNetwork.Internal, true);
    assert.equal(publicNetwork.Internal, false);
    assert.equal(privateNetwork.IPAM.Config[0].Subnet, config.networks.private_subnet.ipam.config[0].subnet);
    assert.equal(publicNetwork.IPAM.Config[0].Subnet, config.networks.public_subnet.ipam.config[0].subnet);
    assert.deepEqual(Object.keys(lbBefore.HostConfig.PortBindings), ['80/tcp']);
    const bindings = lbBefore.NetworkSettings.Ports['80/tcp'];
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].HostIp, '127.0.0.1');
    base = `http://127.0.0.1:${bindings[0].HostPort}`;
    report.baseUrl = base;
    return { publicName, privateName, publicSubnet: publicNetwork.IPAM.Config, privateSubnet: privateNetwork.IPAM.Config };
  });

  await check('Nginx validates its real container configuration', async () => {
    await compose('exec', '-T', 'load-balancer', 'nginx', '-t');
    return 'nginx -t exited successfully';
  });

  await check('Gateway liveness and application readiness return 200', async () => {
    const live = await requestJson(`${base}/healthz`, agent);
    const ready = await requestJson(`${base}/readyz`, agent);
    assert.equal(live.ok, true);
    assert.equal(live.body.component, 'load-balancer');
    assert.equal(ready.ok, true);
    assert.equal(ready.body.status, 'ok');
    return { live, ready };
  });

  const balanced = await check('10 consecutive requests alternate evenly', async () => {
    const rows = await series('round-robin', 10);
    return { counts: assertRoundRobin(rows), rows };
  });

  await check('Client and upstream HTTP keep-alive reuse; request headers', async () => {
    assert.equal(new Set(balanced.rows.map(row => row.localPort)).size, 1, 'Client connection was not reused');
    for (const id of expectedIds) {
      const rows = balanced.rows.filter(row => row.instanceId === id);
      assert.ok(rows.every(row => row.backendConnection && row.cacheControl === 'no-store' && row.requestId && row.body.requestId === row.requestId));
      assert.equal(new Set(rows.map(row => row.backendConnection)).size, 1, `${id} connection was not reused`);
    }
    return 'One client socket and one upstream socket per backend served the measured sequence';
  });

  await check('Zero failed requests during forced backend stop', async () => {
    const rows = [];
    let stop;
    for (let i = 0; i < 60; i++) {
      if (i === 10) {
        restoreBackend = true;
        // An explicit stop suppresses the restart policy and leaves the node down.
        // Run asynchronously so requests continue while Docker stops the container.
        stop = compose('stop', '-t', '0', 'backend1').then(
          () => ({ ok: true }), error => ({ ok: false, error }),
        );
      }
      rows.push(await sample('during-stop'));
      await delay(60);
    }
    const stopped = await stop;
    if (!stopped.ok) throw stopped.error;
    const state = JSON.parse(await docker(['inspect', backend1.Id]))[0].State;
    assert.equal(state.Running, false);
    assertSuccessful(rows);
    return { requests: rows.length, failures: rows.filter(row => !row.ok).length };
  });

  await check('20 requests with backend1 down all reach Backend-2', async () => {
    const rows = await series('backend1-down', 20);
    assertSuccessful(rows, 'Backend-2');
    return { requests: rows.length, failures: 0, survivingBackend: 'Backend-2' };
  });

  await check('Restarted backend automatically rejoins without Nginx restart', async () => {
    await compose('start', 'backend1');
    await waitHealthy('backend1');
    const deadline = Date.now() + 20_000;
    const rows = [];
    while (Date.now() < deadline) {
      rows.push(await sample('recovery'));
      assertSuccessful(rows);
      if (new Set(rows.map(row => row.instanceId)).size === 2) break;
      await delay(250);
    }
    assert.equal(new Set(rows.map(row => row.instanceId)).size, 2, 'Backend did not re-enter the pool');
    const lbAfter = await inspectService('load-balancer');
    assert.equal(lbAfter.Id, lbBefore.Id);
    assert.equal(lbAfter.State.StartedAt, lbBefore.State.StartedAt);
    restoreBackend = false;
    return { observedIds: [...new Set(rows.map(row => row.instanceId))], loadBalancerRestarted: false };
  });

  await check('Host TCP ports 3000, 3001 and 3002 reject direct connections', async () => {
    const outcomes = [];
    for (const port of [3000, 3001, 3002]) outcomes.push(await closedHostPort(port));
    return outcomes;
  });

  await check('Public-only client reaches gateway but cannot connect to actual backend IPs', async () => {
    const first = await inspectService('backend1');
    const second = await inspectService('backend2');
    const ips = [first, second].map(info => info.NetworkSettings.Networks[privateName].IPAddress);
    const code = await fs.readFile(path.join(root, 'scripts/boundary-probe.mjs'), 'utf8');
    return docker(['run', '--rm', '--network', publicName, '--entrypoint', 'node', first.Image,
      '--input-type=module', '-e', code, 'http://load-balancer/healthz', ...ips]);
  });

  await check('Private-network positive control: backend1 can reach backend2', async () => {
    const code = "const r=await fetch('http://backend2:3000/healthz',{signal:AbortSignal.timeout(4000)}); const j=await r.json(); if(!r.ok||j.instanceId!=='Backend-2')process.exit(1); console.log(JSON.stringify(j));";
    return compose('exec', '-T', 'backend1', 'node', '--input-type=module', '-e', code);
  });
  report.status = 'PASS';
} catch (error) {
  report.status = error.code === 'ENOENT' ? 'BLOCKED' : 'FAIL';
  report.error = error.code === 'ENOENT' ? 'Docker CLI is not installed or is not on PATH. Install/start Docker Desktop, then rerun.' : error.message;
  console.error(`\n${report.status}: ${report.error}`);
  process.exitCode = 1;
} finally {
  if (restoreBackend) {
    try {
      await compose('start', 'backend1');
      await waitHealthy('backend1');
      report.cleanup = 'backend1 restored and healthy';
    } catch (error) {
      report.cleanup = `RESTORE FAILED: ${error.message}. Run docker compose start backend1.`;
      process.exitCode = 1;
    }
  }
  agent.destroy();
  report.finishedAt = new Date().toISOString();
  report.totalRequests = report.requests.length;
  report.failedRequests = report.requests.filter(row => !row.ok).length;
  await fs.mkdir(path.join(root, 'evidence'), { recursive: true });
  await fs.writeFile(path.join(root, 'evidence/qa-latest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nSaved evidence/qa-latest.json. Integration result: ${report.status}. Browser checks remain manual.`);
}

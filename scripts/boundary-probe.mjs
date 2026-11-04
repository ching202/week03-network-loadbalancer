// Executed inside a disposable container attached ONLY to public_subnet.
import net from 'node:net';
const [gateway, ...privateIps] = process.argv.slice(1);
const response = await fetch(gateway, { signal: AbortSignal.timeout(4000) });
if (!response.ok || (await response.json()).component !== 'load-balancer') {
  throw new Error('Positive control failed: public gateway is unreachable');
}
if (privateIps.length !== 2) throw new Error('Expected two actual private container IPs');
for (const host of privateIps) {
  const outcome = await new Promise(resolve => {
    const socket = net.createConnection({ host, port: 3000 });
    const finish = result => { socket.destroy(); resolve(result); };
    socket.setTimeout(2500, () => finish('timeout'));
    socket.once('connect', () => finish('CONNECTED'));
    socket.once('error', error => finish(error.code));
  });
  if (!['timeout', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'].includes(outcome)) {
    throw new Error(`${host}:3000 isolation check failed: ${outcome}`);
  }
  console.log(JSON.stringify({ source: 'public_subnet', target: `${host}:3000`, outcome }));
}

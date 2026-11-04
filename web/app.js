const byId = id => document.getElementById(id);
let sequence = 0;
let counts = { 'Backend-1': 0, 'Backend-2': 0, errors: 0 };
const buttons = ['one', 'ten', 'clear'].map(byId);

async function send(count) {
  buttons.forEach(button => { button.disabled = true; });
  try {
    for (let i = 0; i < count; i++) {
      byId('status').textContent = `Sending ${i + 1} of ${count}…`;
      const started = performance.now();
      let fields;
      let className = '';
      try {
        const response = await fetch('/api/whoami', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!(payload.instanceId in counts) || payload.instanceId === 'errors') throw new Error('Unexpected backend identifier');
        counts[payload.instanceId]++;
        fields = [++sequence, payload.instanceId, payload.hostname, response.status, `${Math.round(performance.now() - started)} ms`];
        className = payload.instanceId === 'Backend-1' ? 'b1' : 'b2';
        byId('payload').textContent = JSON.stringify(payload, null, 2);
      } catch (error) {
        counts.errors++;
        fields = [++sequence, 'Request failed', '—', error.message, `${Math.round(performance.now() - started)} ms`];
        className = 'failed';
        byId('payload').textContent = error.message;
      }
      byId('empty')?.remove();
      const row = document.createElement('tr');
      fields.forEach((field, index) => {
        const cell = document.createElement('td');
        cell.textContent = field;
        if (index === 1) cell.className = className;
        row.appendChild(cell);
      });
      byId('history').appendChild(row);
      if (byId('history').children.length > 100) byId('history').firstElementChild.remove();
      byId('count1').textContent = counts['Backend-1'];
      byId('count2').textContent = counts['Backend-2'];
      byId('errors').textContent = counts.errors;
    }
    byId('status').textContent = `Complete · ${sequence} total requests`;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}
byId('one').addEventListener('click', () => send(1));
byId('ten').addEventListener('click', () => send(10));
byId('clear').addEventListener('click', () => {
  sequence = 0;
  counts = { 'Backend-1': 0, 'Backend-2': 0, errors: 0 };
  byId('history').replaceChildren();
  ['count1', 'count2', 'errors'].forEach(id => { byId(id).textContent = '0'; });
  byId('payload').textContent = 'No requests yet.';
  byId('status').textContent = 'Ready to send';
});

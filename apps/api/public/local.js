const element = (id) => document.getElementById(id);
element('facts').value = JSON.stringify({ facts: [{ id: 'planetarium', statement: 'El planetario de Puerto Aurora abre los viernes.', sourceUrl: 'https://example.com/planetario' }] }, null, 2);
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.message ?? 'Request failed'}`);
  return data;
}
async function run(form, output, action) {
  const button = form.querySelector('button');
  button.disabled = true;
  output.textContent = 'Loading…';
  try { output.textContent = JSON.stringify(await action(), null, 2); }
  catch (error) { output.textContent = error.message; }
  finally { button.disabled = false; }
}
element('ingest').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(event.currentTarget, element('ingest-result'), () => api('/api/facts/ingest', JSON.parse(element('facts').value)));
});
element('check').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(event.currentTarget, element('check-result'), async () => {
    const body = { claim: element('claim').value };
    const scenario = element('scenario').value;
    const evidence = await api('/api/facts/search', body);
    const result = await api(`/api/fact-check${scenario ? `?scenario=${encodeURIComponent(scenario)}` : ''}`, body);
    return { evidence, result };
  });
});
element('list').addEventListener('click', async () => {
  try { element('corpus').textContent = JSON.stringify(await api('/api/facts'), null, 2); }
  catch (error) { element('corpus').textContent = error.message; }
});

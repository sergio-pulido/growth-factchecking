import { CLAIM_MAX_LENGTH, DEMO_SCENARIOS } from '@growth-factcheking/shared';
import type { DemoScenario } from '@growth-factcheking/shared';
import type { DemoRequest, DemoResponse } from './messages.js';
import { createMeetDemo } from './meet-demo.js';
import styles from './overlay.css';
import { verdictLabels } from './verdict-labels.js';

const demoClaim = 'La biblioteca de Puerto Aurora abre los sábados.';
const scenarioLabels: Record<DemoScenario, string> = {
  ...verdictLabels,
  no_evidence: 'Sin fuentes',
  error: 'Error de servicio',
};

declare global {
  interface Window {
    growthFactCheckingOverlay?: () => void;
  }
}

function mountOverlay() {
  const claim = window.getSelection()?.toString().trim().slice(0, CLAIM_MAX_LENGTH) || demoClaim;
  window.growthFactCheckingOverlay?.();

  const host = document.createElement('div');
  host.id = 'growth-factchecking-overlay';
  const shadow = host.attachShadow({ mode: 'closed' });
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(styles);
  shadow.adoptedStyleSheets = [stylesheet];

  const panel = document.createElement('section');
  const title = document.createElement('h2');
  title.id = 'factchecking-title';
  title.textContent = 'FactChecking';
  panel.setAttribute('aria-labelledby', title.id);

  const header = document.createElement('header');
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Cerrar');
  close.textContent = '×';
  header.append(title, close);
  panel.append(header);

  const demo = document.createElement('p');
  demo.className = 'demo-label';
  demo.textContent = 'Datos simulados';
  const quote = document.createElement('blockquote');
  quote.textContent = claim;

  const form = document.createElement('form');
  const label = document.createElement('label');
  label.htmlFor = 'factchecking-scenario';
  label.textContent = 'Escenario de prueba';
  const select = document.createElement('select');
  select.id = label.htmlFor;
  for (const scenario of DEMO_SCENARIOS) {
    select.add(new Option(scenarioLabels[scenario], scenario));
  }
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Probar';
  form.append(label, select, submit);

  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const sources = document.createElement('div');
  sources.hidden = true;
  const sourceTitle = document.createElement('h3');
  sourceTitle.textContent = 'Fuentes de ejemplo';
  const sourceList = document.createElement('ul');
  sources.append(sourceTitle, sourceList);
  const scenarioView = document.createElement('div');
  scenarioView.append(demo, quote, form, status, sources);
  const meet = createMeetDemo();
  const changeView = document.createElement('button');
  changeView.type = 'button';
  changeView.className = 'meet-switch';

  function showMeet(show: boolean) {
    scenarioView.hidden = show;
    meet.view.hidden = !show;
    changeView.textContent = show ? 'Volver a escenarios' : 'Simular Google Meet';
    title.textContent = show ? 'Simulación de Google Meet' : 'FactChecking';
    if (!show) meet.stop();
  }

  showMeet(window.location.hostname === 'meet.google.com');
  changeView.addEventListener('click', () => showMeet(meet.view.hidden));
  panel.append(changeView, scenarioView, meet.view);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const scenario = DEMO_SCENARIOS.find((value) => value === select.value);
    if (!scenario || submit.disabled) return;

    submit.disabled = true;
    select.disabled = true;
    sources.hidden = true;
    sourceList.replaceChildren();
    status.textContent = 'Cargando…';

    try {
      const response = await chrome.runtime.sendMessage<DemoRequest, DemoResponse>({ claim, scenario });
      if (!response.ok) {
        status.textContent = response.message;
        return;
      }

      const result = response.result;
      status.textContent = result.sources.length === 0
        ? `${verdictLabels[result.verdict]} · Sin fuentes`
        : verdictLabels[result.verdict];
      for (const source of result.sources) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = source.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = source.statement;
        item.append(link);
        sourceList.append(item);
      }
      sources.hidden = result.sources.length === 0;
    } catch (error) {
      console.warn('No se pudo mostrar el resultado de demostración.', error);
      status.textContent = 'No se pudo cargar el resultado. Vuelve a abrir el panel.';
    } finally {
      submit.disabled = false;
      select.disabled = false;
    }
  });

  const previousFocus = document.activeElement;
  function dismiss() {
    meet.stop();
    host.remove();
    window.growthFactCheckingOverlay = undefined;
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }

  close.addEventListener('click', dismiss);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dismiss();
  });

  window.growthFactCheckingOverlay = dismiss;
  shadow.append(panel);
  document.documentElement.append(host);
  close.focus();
}

mountOverlay();

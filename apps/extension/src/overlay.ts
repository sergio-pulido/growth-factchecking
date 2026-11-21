import { CLAIM_MAX_LENGTH, DEMO_SCENARIOS } from '@growth-factcheking/shared';
import type { DemoScenario } from '@growth-factcheking/shared';
import type { FactCheckMessage, FactCheckMode, FactCheckResponse } from './messages.js';
import { createMeetDemo } from './meet-demo.js';
import styles from './overlay.css';
import { verdictLabels } from './verdict-labels.js';

const demoClaim = 'La biblioteca de Puerto Aurora abre los sábados.';
const sourcePreference = 'factCheckSource';
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
  const selection = window.getSelection()?.toString().trim().slice(0, CLAIM_MAX_LENGTH) || '';
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
  const quote = document.createElement('blockquote');

  const form = document.createElement('form');
  const modeLabel = document.createElement('label');
  modeLabel.htmlFor = 'factchecking-mode';
  modeLabel.textContent = 'Fuente de verificación';
  const modeSelect = document.createElement('select');
  modeSelect.id = modeLabel.htmlFor;
  modeSelect.className = 'factchecking-mode';
  modeSelect.add(new Option('Simulado', 'mock'));
  modeSelect.add(new Option('Real', 'live'));
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
  form.append(modeLabel, modeSelect, label, select, submit);

  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const sources = document.createElement('div');
  sources.hidden = true;
  const sourceTitle = document.createElement('h3');
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
    changeView.textContent = show ? 'Volver a verificación' : 'Simular Google Meet';
    title.textContent = show ? 'Simulación de Google Meet' : 'FactChecking';
    if (!show) meet.stop();
  }

  showMeet(window.location.hostname === 'meet.google.com');
  changeView.addEventListener('click', () => showMeet(meet.view.hidden));
  panel.append(changeView, scenarioView, meet.view);

  let mode: FactCheckMode = 'mock';
  let busy = true;

  function setBusy(value: boolean) {
    busy = value;
    modeSelect.disabled = value;
    select.disabled = value;
    submit.disabled = value || (mode === 'live' && !selection);
  }

  function clearSources() {
    sources.hidden = true;
    sourceList.replaceChildren();
  }

  function renderMode() {
    const live = mode === 'live';
    modeSelect.value = mode;
    demo.textContent = live ? 'Verificación con OpenAI y el corpus local' : 'Datos simulados';
    quote.textContent = live ? selection : selection || demoClaim;
    quote.hidden = live && !selection;
    label.hidden = live;
    select.hidden = live;
    submit.classList.toggle('factchecking-live-submit', live);
    submit.textContent = live ? 'Verificar' : 'Probar';
    status.textContent = live && !selection
      ? 'Selecciona texto de la página y vuelve a abrir el panel.'
      : '';
    clearSources();
  }

  renderMode();
  setBusy(true);
  void chrome.storage.local.get(sourcePreference).then((stored) => {
    mode = stored[sourcePreference] === 'live' ? 'live' : 'mock';
    renderMode();
  }, (error: unknown) => {
    console.warn('No se pudo leer la fuente de verificación.', error);
    status.textContent = 'No se pudo leer la preferencia. Se usa el modo simulado.';
  }).finally(() => setBusy(false));

  modeSelect.addEventListener('change', async () => {
    if (busy) return;
    const nextMode = modeSelect.value === 'live' ? 'live' : 'mock';
    setBusy(true);
    try {
      await chrome.storage.local.set({ [sourcePreference]: nextMode });
      mode = nextMode;
      renderMode();
    } catch (error) {
      console.warn('No se pudo guardar la fuente de verificación.', error);
      modeSelect.value = mode;
      status.textContent = 'No se pudo guardar el cambio de modo. Vuelve a intentarlo.';
    } finally {
      setBusy(false);
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;

    let message: FactCheckMessage;
    if (mode === 'live') {
      message = { mode, claim: selection };
    } else {
      const scenario = DEMO_SCENARIOS.find((value) => value === select.value);
      if (!scenario) return;
      message = { mode, claim: selection || demoClaim, scenario };
    }

    setBusy(true);
    clearSources();
    status.textContent = 'Cargando…';

    try {
      const response = await chrome.runtime.sendMessage<FactCheckMessage, FactCheckResponse>(message);
      if (!response.ok) {
        status.textContent = response.message;
        return;
      }

      const { check: result, mode: resultMode } = response.result;
      status.textContent = result.sources.length === 0
        ? `${verdictLabels[result.verdict]} · Sin fuentes`
        : verdictLabels[result.verdict];
      sourceTitle.textContent = resultMode === 'mock' ? 'Fuentes de ejemplo' : 'Fuentes';
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
      console.warn('No se pudo mostrar el resultado de la verificación.', error);
      status.textContent = 'No se pudo cargar el resultado. Vuelve a abrir el panel.';
    } finally {
      setBusy(false);
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

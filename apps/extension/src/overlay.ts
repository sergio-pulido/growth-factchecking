import { CLAIM_MAX_LENGTH, DEMO_SCENARIOS } from '@growth-factcheking/shared';
import type { DemoScenario } from '@growth-factcheking/shared';
import type { FactCheckMessage, FactCheckMode, FactCheckResponse } from './messages.js';
import { isXFactCheckPage, startInlineFeed } from './inline-feed.js';
import { createInterviewDemo } from './interview-demo.js';
import styles from './overlay.css';
import { verdictLabels } from './verdict-labels.js';

const demoClaim = 'The Puerto Aurora library opens on Saturdays.';
const sourcePreference = 'factCheckSource';
const scenarioLabels: Record<DemoScenario, string> = {
  ...verdictLabels,
  no_evidence: 'No sources',
  error: 'Service error',
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
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  const minimise = document.createElement('button');
  minimise.type = 'button';
  minimise.className = 'panel-min';
  minimise.setAttribute('aria-label', 'Minimise');
  minimise.setAttribute('aria-pressed', 'false');
  minimise.textContent = '–';
  minimise.addEventListener('click', () => {
    const minimised = panel.classList.toggle('is-min');
    minimise.setAttribute('aria-pressed', String(minimised));
  });
  header.append(title, minimise, close);
  panel.append(header);

  // Drag the panel by its header. transform is not set by the :host rules, so it applies.
  let dragX = 0;
  let dragY = 0;
  header.addEventListener('pointerdown', (event) => {
    if (event.target instanceof HTMLButtonElement) return;
    const startX = event.clientX - dragX;
    const startY = event.clientY - dragY;
    header.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      dragX = moveEvent.clientX - startX;
      dragY = moveEvent.clientY - startY;
      host.style.transform = `translate(${dragX}px, ${dragY}px)`;
    };
    const end = () => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', end);
      header.removeEventListener('pointercancel', end);
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
  });

  const demo = document.createElement('p');
  demo.className = 'demo-label';
  const quote = document.createElement('blockquote');

  const form = document.createElement('form');
  const modeLabel = document.createElement('label');
  modeLabel.htmlFor = 'factchecking-mode';
  modeLabel.textContent = 'Checking source';
  const modeSelect = document.createElement('select');
  modeSelect.id = modeLabel.htmlFor;
  modeSelect.className = 'factchecking-mode';
  modeSelect.add(new Option('Simulated', 'mock'));
  modeSelect.add(new Option('Real', 'live'));
  const label = document.createElement('label');
  label.htmlFor = 'factchecking-scenario';
  label.textContent = 'Test scenario';
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
  const meet = createInterviewDemo((busy) => host.toggleAttribute('data-busy', busy), {
    isMinimised: () => panel.classList.contains('is-min'),
    expand: () => {
      panel.classList.remove('is-min');
      minimise.setAttribute('aria-pressed', 'false');
      showMeet(true);
    },
  });
  const changeView = document.createElement('button');
  changeView.type = 'button';
  changeView.className = 'meet-switch';

  function showMeet(show: boolean) {
    scenarioView.hidden = show;
    meet.view.hidden = !show;
    changeView.textContent = show ? 'Back to checks' : 'Play interview demo';
    title.textContent = show ? 'The Wild Project demo' : 'FactChecking';
    if (!show) meet.stop();
  }

  showMeet(['meet.google.com', 'www.youtube.com', 'youtube.com'].includes(window.location.hostname));
  changeView.addEventListener('click', () => showMeet(meet.view.hidden));
  if (isXFactCheckPage()) {
    const active = Boolean(window.growthFactCheckingFeed);
    const feed = document.createElement('div');
    feed.className = 'feed-controls';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = active ? 'Pause inline checks' : 'Start inline checks';

    const note = document.createElement('p');
    note.className = 'demo-label';
    note.textContent = active
      ? 'Inline checks are active in this tab.'
      : 'Checks the text of visible posts through the local API and OpenAI.';

    toggle.addEventListener('click', () => {
      if (window.growthFactCheckingFeed) window.growthFactCheckingFeed();
      else startInlineFeed();
      dismiss();
    });
    feed.append(toggle, note);
    scenarioView.prepend(feed);
  }
  panel.append(meet.toasts, changeView, scenarioView, meet.view);

  let mode: FactCheckMode = 'mock';
  let busy = true;

  function setBusy(value: boolean) {
    busy = value;
    host.toggleAttribute('data-busy', value);
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
    demo.textContent = live ? 'Checked with OpenAI and the local corpus' : 'Simulated data';
    quote.textContent = live ? selection : selection || demoClaim;
    quote.hidden = live && !selection;
    label.hidden = live;
    select.hidden = live;
    submit.classList.toggle('factchecking-live-submit', live);
    submit.textContent = live ? 'Check' : 'Try';
    status.textContent = live && !selection
      ? 'Select text on the page and reopen the panel.'
      : '';
    clearSources();
  }

  renderMode();
  setBusy(true);
  void chrome.storage.local.get(sourcePreference).then((stored) => {
    mode = stored[sourcePreference] === 'live' ? 'live' : 'mock';
    renderMode();
  }, (error: unknown) => {
    console.warn('Could not read the checking source.', error);
    status.textContent = 'Could not read your preference. Using simulated mode.';
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
      console.warn('Could not save the checking source.', error);
      modeSelect.value = mode;
      status.textContent = 'Could not save the mode change. Try again.';
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
    status.textContent = 'Checking…';

    try {
      const response = await chrome.runtime.sendMessage<FactCheckMessage, FactCheckResponse>(message);
      if (!response.ok) {
        status.textContent = response.message;
        return;
      }

      const { check: result, mode: resultMode } = response.result;
      status.textContent = result.sources.length === 0
        ? `${verdictLabels[result.verdict]} · No sources`
        : verdictLabels[result.verdict];
      sourceTitle.textContent = resultMode === 'mock' ? 'Sample sources' : 'Sources';
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
      console.warn('Could not show the check result.', error);
      status.textContent = 'Could not load the result. Reopen the panel.';
    } finally {
      setBusy(false);
    }
  });

  const previousFocus = document.activeElement;
  function dismiss() {
    meet.destroy();
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

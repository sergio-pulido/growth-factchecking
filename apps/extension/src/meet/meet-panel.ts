// Minimal default UI for Meet capture. UX/UI can replace it: it only uses the public controller API.
import type { MeetCaptureController, MeetCaptureState } from './capture-controller.js';
import { verdictLabels } from '../verdict-labels.js';

const STYLES = `
:host { all: initial; }
section { position: fixed; left: 16px; bottom: 96px; z-index: 2147483647; width: min(360px, calc(100vw - 32px));
  max-height: 60vh; overflow: auto; box-sizing: border-box; padding: 12px 14px; border-radius: 12px;
  background: #fff; color: #1f1f1f; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
h2 { margin: 0; font-size: 14px; }
button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid #c4c7c5; background: #fff; padding: 6px 10px; }
button.primary { background: #0b57d0; border-color: #0b57d0; color: #fff; }
button.danger { background: #b3261e; border-color: #b3261e; color: #fff; }
button:disabled { opacity: .6; cursor: default; }
.indicator { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: #b3261e; }
.indicator::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: #b3261e; }
.muted { color: #5e5e5e; margin: 6px 0; }
.error { color: #b3261e; margin: 6px 0; }
ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
li { border-top: 1px solid #e3e3e3; padding-top: 6px; }
.verdict { font-weight: 600; }
.pill { position: fixed; left: 16px; bottom: 96px; z-index: 2147483647; }
@media (prefers-color-scheme: dark) {
  section { background: #1f1f1f; color: #e3e3e3; } .muted { color: #a8a8a8; } li { border-color: #444; }
  button { background: #2b2b2b; color: #e3e3e3; border-color: #555; }
}`;

const STATUS_TEXT: Record<MeetCaptureState['status'], string> = {
  idle: 'Tell participants before you start. Only the visible captions in this tab are read.',
  starting: 'Starting…',
  capturing: '',
  stopping: 'Sending what is pending and closing…',
  stopped: 'Capture stopped.',
  error: '',
};

export function mountMeetPanel(controller: MeetCaptureController): { show(): void } {
  const host = document.createElement('div');
  host.id = 'growth-factchecking-meet';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'FactChecking on Meet');
  const pill = document.createElement('button');
  pill.className = 'pill danger';
  pill.hidden = true;
  shadow.append(style, panel, pill);

  let collapsed = true;
  let state = controller.getState();

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  const render = (): void => {
    // While capturing, a visible indicator stays on screen even when the panel is collapsed.
    pill.hidden = !(collapsed && state.active);
    pill.textContent = '● Transcribing · Open';
    panel.hidden = collapsed;
    if (collapsed) return;

    const header = el('header');
    header.append(el('h2', 'FactChecking · Meet'));
    const close = el('button', '×');
    close.setAttribute('aria-label', state.active ? 'Minimise (capture keeps running)' : 'Close');
    close.addEventListener('click', () => { collapsed = true; render(); });
    header.append(close);

    const status = el('p', '', 'muted');
    status.setAttribute('role', 'status');
    if (state.status === 'capturing') {
      status.replaceChildren(el('span', 'Transcribing', 'indicator'));
    } else {
      status.textContent = STATUS_TEXT[state.status];
    }

    const action = state.active
      ? el('button', 'Stop', 'danger')
      : el('button', 'Start transcribing', 'primary');
    action.disabled = state.status === 'starting' || state.status === 'stopping';
    action.addEventListener('click', () => { void (state.active ? controller.stop() : controller.start()); });

    const nodes: Node[] = [header, status, action];
    if (state.status === 'capturing' && !state.captionsDetected) {
      nodes.push(el('p', 'No captions visible. Turn on Meet captions (CC).', 'error'));
    }
    if (state.conversationId) {
      nodes.push(el('p', `Sent: ${state.sent} · Pending: ${state.pending}${state.duplicates ? ` · Duplicates: ${state.duplicates}` : ''}`, 'muted'));
    }
    if (state.error) nodes.push(el('p', state.error.message, 'error'));
    if (state.extractionFailures > 0) {
      nodes.push(el('p', `${state.extractionFailures} batches could not be analysed; their transcript was saved.`, 'muted'));
    }
    if (state.claims.length > 0) {
      const list = el('ul');
      for (const claim of [...state.claims].reverse()) {
        const item = el('li');
        const verdict = claim.verdict ? verdictLabels[claim.verdict] : 'Not checked';
        item.append(el('div', `${claim.speaker}: ${claim.claim}`), el('div', verdict, 'verdict'));
        const source = claim.sources[0];
        if (source) item.append(el('div', source.statement, 'muted'));
        list.append(item);
      }
      nodes.push(list);
    }
    panel.replaceChildren(...nodes);
  };

  pill.addEventListener('click', () => { collapsed = false; render(); });
  controller.subscribe((next) => { state = next; render(); });
  document.documentElement.append(host);

  return { show() { collapsed = false; render(); } };
}

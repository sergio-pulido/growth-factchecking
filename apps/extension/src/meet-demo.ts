import { MEET_JUDGES, MEET_TRANSCRIPT } from '@growth-factcheking/shared';
import type { MeetCheckResult, MeetJudge, MeetTurn } from '@growth-factcheking/shared';
import type { MeetDemoRequest, MeetDemoResponse } from './messages.js';
import { verdictLabels } from './verdict-labels.js';

const speakers: Record<MeetTurn['speaker'], string> = {
  investor: 'Clara · Inversora',
  founder: 'Mateo · Emprendedor',
};

const modes: Record<MeetJudge, string> = {
  mock: 'Simulado',
  decisions: 'OpenAI Decisions',
};

function text<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, content: string) {
  const node = document.createElement(tag);
  node.textContent = content;
  return node;
}

function renderTurn(turn: MeetTurn) {
  const row = document.createElement('li');
  row.className = 'meet-turn';
  row.dataset.speaker = turn.speaker;

  const minute = Math.floor(turn.atSeconds / 60);
  const second = (turn.atSeconds % 60).toString().padStart(2, '0');
  const caption = document.createElement('div');
  caption.className = 'meet-turn-meta';
  caption.append(text('strong', speakers[turn.speaker]), text('span', `${minute}:${second}`));
  row.append(caption, text('p', turn.text));
  return row;
}

function renderCheck(check: MeetCheckResult['checks'][number]) {
  const item = document.createElement('li');
  item.className = 'meet-check';
  item.dataset.verdict = check.verdict;
  const verdict = check.sources.length === 0 ? 'Neutral · Sin fuentes' : verdictLabels[check.verdict];
  item.append(text('strong', verdict), text('p', check.claim));

  if (check.sources.length) {
    const detail = document.createElement('details');
    const list = document.createElement('ul');
    for (const { statement, sourceUrl } of check.sources) {
      const source = document.createElement('li');
      const link = text('a', statement);
      link.href = sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      source.append(link);
      list.append(source);
    }
    detail.append(text('summary', 'Fuentes ficticias'), list);
    item.append(detail);
  }
  return item;
}

export function createMeetDemo() {
  const view = document.createElement('div');
  view.className = 'meet-demo';
  const caption = text('p', 'Transcripción y fuentes ficticias');
  caption.className = 'demo-label';
  const controls = document.createElement('form');
  const label = text('label', 'Motor de contraste');
  label.htmlFor = 'factchecking-meet-mode';
  const select = document.createElement('select');
  select.id = label.htmlFor;
  for (const mode of MEET_JUDGES) {
    select.add(new Option(modes[mode], mode));
  }
  const play = text('button', 'Reproducir');
  play.type = 'submit';
  controls.append(label, select, play);

  const status = text('p', '');
  status.setAttribute('role', 'status');
  const transcript = document.createElement('ol');
  transcript.className = 'meet-transcript';
  transcript.setAttribute('role', 'list');
  view.append(caption, controls, status, transcript);

  let active: AbortController | undefined;
  controls.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (active) return;
    const mode = MEET_JUDGES.find((value) => value === select.value);
    if (!mode) return;

    active = new AbortController();
    const { signal } = active;
    play.disabled = true;
    select.disabled = true;
    transcript.replaceChildren();

    let checked = 0;
    let failed = 0;
    try {
      for (const turn of MEET_TRANSCRIPT) {
        if (signal.aborted) return;

        const row = renderTurn(turn);
        transcript.append(row);
        status.textContent = 'Reproduciendo conversación…';
        if (turn.speaker === 'founder') {
          status.textContent = 'Extrayendo y contrastando afirmaciones…';
          const response = await chrome.runtime.sendMessage<MeetDemoRequest, MeetDemoResponse>({
            kind: 'meet-check', turnId: turn.id, mode,
          }).catch((error: unknown): MeetDemoResponse => {
            console.warn('No se pudo contrastar el turno de Meet.', error);
            return { ok: false, message: 'No se pudo conectar con la extensión. Vuelve a abrir el panel.' };
          });
          if (signal.aborted) return;

          if (response?.ok) {
            if (response.result.checks.length) {
              const checks = document.createElement('ul');
              checks.className = 'meet-checks';
              checks.setAttribute('role', 'list');
              checks.append(...response.result.checks.map(renderCheck));
              row.append(checks);
              checked += response.result.checks.length;
            }
          } else {
            const error = text('p', response?.message ?? 'La extensión no devolvió un resultado.');
            error.className = 'meet-error';
            row.append(error);
            failed += 1;
          }
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 650));
      }
      if (signal.aborted) return;
      const total = checked === 1 ? '1 afirmación contrastada' : `${checked} afirmaciones contrastadas`;
      const errors = failed === 1 ? '1 turno con errores' : `${failed} turnos con errores`;
      status.textContent = [modes[mode], total, failed ? errors : null].filter(Boolean).join(' · ');
    } finally {
      active = undefined;
      play.disabled = false;
      select.disabled = false;
      if (!signal.aborted) play.textContent = 'Volver a reproducir';
    }
  });

  return { view, stop: () => active?.abort() };
}

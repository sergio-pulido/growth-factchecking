// The FactCheck island over a call: a pill that morphs into the panel. Spec: docs/specs/call-overlay.md
import { createBubbles, flashFrame } from './alerts.js';
import { analyzingCard, claimCard, ORDER, TONES, transcriptLine } from './cards.js';
import { clock, h, icon } from './dom.js';
import styles from './call.css';
import { createCallSession } from './session.js';
import type { SessionOptions } from './session.js';
import { ATTENTION } from './types.js';
import type { CallTransport, CaptureSource, ClaimItem, SessionSnapshot } from './types.js';

type Filter = 'all' | 'attention' | 'transcript';

const EASE = 'cubic-bezier(.32,.72,0,1)';

const LIVE_TEXT: Record<SessionSnapshot['state'], string> = {
  idle: 'Not started', starting: 'Connecting…', live: 'Transcribing', paused: 'Paused', ending: 'Saving…', ended: 'Ended',
};

export type CallPanel = {
  readonly capture: CaptureSource['capture'];
  open(): void;
  toggle(): void;
  destroy(): void;
};

export type PanelOptions = SessionOptions & {
  /** Opens the panel that checks the text selected on the page. */
  onCheckSelection?: () => void;
  /** Starts checking right away, as a small pill, without waiting for "Start checking". */
  autoStart?: boolean;
};

const isAttention = (item: ClaimItem) => item.state === 'checked' && item.verdict !== null && ATTENTION.has(item.verdict);

export function mountCallPanel(source: CaptureSource, transport: CallTransport, options: PanelOptions = {}): CallPanel {
  const host = h('div', { id: 'growth-factchecking-call' });
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles);
  shadow.adoptedStyleSheets = [sheet];

  const flash = h('div', { class: 'screen-flash', 'aria-hidden': 'true' });
  const bubbleList = h('div', { class: 'bubbles', 'aria-live': 'polite' });
  const face = h('div', { class: 'pill-face', role: 'group', 'aria-label': 'FactCheck' });
  const live = h('span', { class: 'live off' }, h('i'), h('span', {}, ''));
  const pauseButton = h('button', { class: 'icon-btn', type: 'button' }, icon('mic'));
  const minimize = h('button', { class: 'icon-btn', type: 'button', title: 'Minimise', 'aria-label': 'Minimise' }, icon('minimize'));
  const sumText = h('span');
  const sumAttention = h('span', { class: 'sum-attn' });
  const distbar = h('div', { class: 'distbar' });
  const tabButtons: Record<Filter, HTMLButtonElement> = {
    all: h('button', { type: 'button', 'aria-pressed': 'true' }),
    attention: h('button', { type: 'button', 'aria-pressed': 'false' }),
    transcript: h('button', { type: 'button', 'aria-pressed': 'false' }),
  };
  const notice = h('div', { class: 'notice', role: 'status' });
  const feed = h('div', { class: 'feed', 'aria-live': 'polite' });
  const foot = h('div', { class: 'p-foot' });
  const logo = () => h('span', { class: 'logo' }, icon('check', '#fff'));
  const body = h('div', { class: 'p-body' },
    h('div', { class: 'p-head' }, logo(), h('span', { class: 'p-title' }, 'FactCheck'), live,
      h('span', { class: 'spacer' }), pauseButton, minimize),
    h('div', { class: 'summary' }, h('div', { class: 'sum-line' }, sumText, sumAttention), distbar),
    h('div', { class: 'tabs' }, tabButtons.all, tabButtons.attention, tabButtons.transcript),
    notice, feed, foot);
  const panel = h('aside', { class: 'panel', 'aria-label': 'Panel de FactCheck' }, face, body);
  shadow.append(flash, h('div', { class: 'dock' }, bubbleList), panel);

  let open = false;
  let filter: Filter = 'all';
  let target: string | null = null;
  let flashIds = new Set<string>();
  let pillKey = '';
  let feedKey = '';
  let badge = -1;

  const anchorBottom = source.anchorBottom;
  host.style.setProperty('--anchor-b', `${anchorBottom}px`);
  const session = createCallSession(source, transport, { onChange: render, onVerdict }, options);
  const bubbles = createBubbles(bubbleList, openAt);

  function onVerdict(item: ClaimItem) {
    if (!item.verdict) return;
    // True / false: the border of the video (tab audio) or of the screen (call apps) turns green or red.
    flashFrame(flash, item.verdict, source.platform === 'web' ? 'video' : 'screen');
    if (ATTENTION.has(item.verdict)) flashIds = new Set([...flashIds, item.id]);
    if (!open) {
      bubbles.push(item);
      panel.classList.remove('bump');
      void panel.offsetWidth;
      panel.classList.add('bump');
    }
  }

  function setOpen(next: boolean, instant = false) {
    open = next;
    const width = Math.min(340, window.innerWidth - 32);
    const height = Math.max(260, Math.min(560, window.innerHeight - anchorBottom - 24));
    body.style.width = `${width}px`;
    body.style.height = `${height}px`;
    const to = open
      ? { width: `${width}px`, height: `${height}px`, borderRadius: '28px' }
      : { width: `${face.offsetWidth}px`, height: `${face.offsetHeight}px`, borderRadius: `${face.offsetHeight / 2}px` };
    const from = { width: `${panel.offsetWidth}px`, height: `${panel.offsetHeight}px`, borderRadius: getComputedStyle(panel).borderTopLeftRadius };
    Object.assign(panel.style, to);
    body.inert = !open;
    face.inert = open;
    panel.classList.toggle('is-open', open);
    if (open) bubbles.clear();
    if (instant || !panel.isConnected) {
      body.style.opacity = open ? '1' : '0';
      face.style.opacity = open ? '0' : '1';
      return;
    }
    panel.animate([from, to], { duration: open ? 560 : 460, easing: EASE });
    body.animate(open
      ? [{ opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)' }]
      : [{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(8px)' }],
    { duration: open ? 350 : 160, delay: open ? 100 : 0, fill: 'backwards', easing: 'ease-out' });
    body.style.opacity = open ? '1' : '0';
    face.animate(open ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0px)' }],
      { duration: open ? 120 : 300, delay: open ? 0 : 200, fill: 'backwards' });
    face.style.opacity = open ? '0' : '1';
  }

  function fitPill() {
    if (open || Math.abs(panel.offsetWidth - face.offsetWidth) < 1) return;
    const to = { width: `${face.offsetWidth}px`, height: `${face.offsetHeight}px` };
    panel.animate([{ width: `${panel.offsetWidth}px`, height: `${panel.offsetHeight}px` }, to], { duration: 450, easing: EASE });
    Object.assign(panel.style, to);
  }

  function openAt(id: string) {
    filter = 'all';
    target = id;
    const item = session.snapshot().claims.find((claim) => claim.id === id);
    if (item && !item.open) session.toggleSources(id);
    setOpen(true);
    render(session.snapshot());
    shadow.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function pillButton(className: string, label: string, content: Node, action: () => void) {
    const button = h('button', { class: `pf-btn ${className}`, type: 'button', 'aria-label': label, title: label }, content);
    button.addEventListener('click', action);
    return button;
  }

  function renderPill(snap: SessionSnapshot, attention: number) {
    const capturing = snap.state === 'live' || snap.state === 'paused';
    face.classList.toggle('listening', snap.state === 'live');
    face.classList.toggle('voice', snap.state === 'live' && snap.voice);
    face.classList.toggle('paused', snap.state === 'paused');
    const key = `${snap.state}:${attention}:${snap.claims.length}`;
    if (key === pillKey) return;
    pillKey = key;

    const opener = h('button', { class: 'pf-open', type: 'button', 'aria-label': 'Open FactCheck' }, logo());
    opener.addEventListener('click', () => setOpen(true));
    if (capturing) {
      opener.append(h('span', { class: 'waves', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i')));
      if (attention) opener.append(h('span', { class: 'pf-count', title: `${attention} need attention` }, String(attention)));
    } else if (snap.state === 'starting' || snap.state === 'ending') {
      opener.append(h('span', { class: 'typing', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
    } else {
      opener.append(h('span', { class: 'pf-label' },
        snap.state === 'ended' ? `Ended · ${snap.claims.length} claims`
          : source.capture === 'captions' ? 'Check this call' : 'Check this tab'));
    }
    const children: Node[] = [opener];
    if (capturing) {
      const paused = snap.state === 'paused';
      children.push(
        pillButton('pf-pause', paused ? 'Resume listening' : 'Pause listening', icon(paused ? 'play' : 'pause'),
          () => (paused ? session.resume() : session.pause())),
        pillButton('pf-stop', 'Stop listening', icon('stop'), () => void session.stop()),
      );
    }
    face.replaceChildren(...children);
    requestAnimationFrame(fitPill);
  }

  function renderHead(snap: SessionSnapshot) {
    const on = snap.state === 'live';
    live.className = `live ${on ? 'on' : 'off'}`;
    const elapsed = snap.startedAt ? (Date.now() - snap.startedAt) / 1000 : 0;
    live.lastElementChild!.textContent = on ? `${LIVE_TEXT.live} · ${clock(elapsed)}` : LIVE_TEXT[snap.state];
    const capturing = on || snap.state === 'paused';
    pauseButton.hidden = !capturing;
    const label = snap.state === 'paused' ? 'Resume listening' : 'Pause listening';
    pauseButton.title = label;
    pauseButton.setAttribute('aria-label', label);
    pauseButton.style.color = snap.state === 'paused' ? 'var(--v-pno)' : '';
  }

  function renderSummary(snap: SessionSnapshot, attention: number) {
    const done = snap.claims.filter((item) => item.state === 'checked' && item.verdict);
    const pending = snap.claims.filter((item) => item.state === 'retrying').length;
    const extra = [pending ? `${pending} in progress` : '', snap.analyzing ? 'analysing' : ''].filter(Boolean).join(' · ');
    sumText.replaceChildren(h('strong', {}, String(done.length)), ` checked${extra ? ` · ${extra}` : ''}`);
    sumAttention.textContent = attention ? `${attention} need${attention > 1 ? '' : 's'} attention` : '';
    distbar.replaceChildren(...ORDER.flatMap((verdict) => {
      const count = done.filter((item) => item.verdict === verdict).length;
      if (!count) return [];
      const bar = h('span', { title: `${verdict}: ${count}` });
      bar.style.flexGrow = String(count);
      bar.style.background = `var(${TONES[verdict].color})`;
      return [bar];
    }));
    const counts: Record<Filter, [string, number]> = {
      all: ['All', snap.claims.length], attention: ['Needs attention', attention], transcript: ['Transcript', snap.transcript.length],
    };
    for (const [name, button] of Object.entries(tabButtons) as Array<[Filter, HTMLButtonElement]>) {
      button.replaceChildren(counts[name][0], h('span', { class: 'count' }, String(counts[name][1])));
      button.setAttribute('aria-pressed', String(name === filter));
    }
    const message = snap.notice ?? (snap.state === 'live' && !snap.found ? source.hint : null);
    notice.hidden = !message;
    notice.textContent = message ?? '';
  }

  function consent() {
    const start = h('button', { class: 'btn primary', type: 'button' }, 'Start checking');
    start.addEventListener('click', () => void session.start());
    const usesMicrophone = source.platform === 'meet' && source.capture === 'audio';
    const reads = source.capture === 'captions'
      ? h('li', {}, `reads the ${source.label} captions in this tab, with the speaker's name;`)
      : usesMicrophone
        ? h('li', {}, 'sends your microphone and the other participants’ tab audio to OpenAI for live transcription;')
        : h('li', {}, 'listens to this tab\'s audio and transcribes it with OpenAI; the audio is not stored and speakers are not named;');
    const consentBlock = h('div', { class: 'consent' },
      h('strong', {}, source.platform !== 'web' ? `Check this ${source.label} call` : 'Check this tab\'s audio'),
      h('span', {}, 'Once started, FactCheck:'),
      h('ul', {}, reads,
        h('li', {}, 'saves the transcript and the claims in your local API;'),
        h('li', {}, 'checks each claim against the source corpus.')),
      h('span', {}, 'Tell the participants before you start. You can pause, stop and delete the conversation at any time.'));
    if (usesMicrophone) consentBlock.append(h('span', {}, 'Use Pause or Stop here to stop sending audio. Meet’s mute button controls Meet only.'));
    if (source.language) consentBlock.append(languagePicker(source.language));
    consentBlock.append(start);
    if (options.onCheckSelection) {
      const selection = h('button', { class: 'link', type: 'button' }, 'Check the text selected on the page');
      // Keep the page selection: a click on a button would otherwise clear it.
      selection.addEventListener('mousedown', (event) => event.preventDefault());
      selection.addEventListener('click', () => options.onCheckSelection?.());
      consentBlock.append(selection);
    }
    return consentBlock;
  }

  function languagePicker(choice: NonNullable<CaptureSource['language']>) {
    const group = h('div', { class: 'seg', role: 'group', 'aria-label': 'Conversation language' });
    const buttons = choice.options.map((option) => {
      const button = h('button', { type: 'button', 'aria-pressed': String(option.value === choice.value()) }, option.label);
      button.addEventListener('click', () => {
        choice.set(option.value);
        buttons.forEach((other, index) => other.setAttribute('aria-pressed', String(choice.options[index]!.value === choice.value())));
      });
      return button;
    });
    group.append(...buttons);
    return h('div', { class: 'language' }, h('span', {}, 'Conversation language'), group);
  }

  function empty(title: string, text: string) {
    return h('div', { class: 'empty' }, h('strong', {}, title), text);
  }

  function feedChildren(snap: SessionSnapshot): Node[] {
    if (snap.state === 'idle' && filter !== 'transcript') return [consent()];
    const handlers = { onRetry: (id: string) => void session.retry(id), onToggle: session.toggleSources };
    if (filter === 'transcript') {
      return snap.transcript.length ? snap.transcript.map(transcriptLine)
        : [empty('No transcript yet', `Every sentence FactCheck ${source.capture === 'captions' ? 'reads from the captions' : 'transcribes from the audio'} and saves will show here.`)];
    }
    const list = filter === 'attention' ? snap.claims.filter(isAttention) : snap.claims;
    const cards: Node[] = list.map((item) => {
      const extra = [flashIds.has(item.id) ? 'flash' : '', item.id === target ? 'target' : ''].join(' ');
      return claimCard(item, handlers, extra);
    });
    if (filter === 'all' && snap.analyzing) cards.push(analyzingCard(snap.analyzing));
    if (cards.length) return cards;
    return filter === 'attention'
      ? [empty('Nothing doubtful so far', 'Claims rated False or Likely false will show here.')]
      : [empty('No claims yet', 'When someone says something checkable, it shows here with its verdict.')];
  }

  function renderFeed(snap: SessionSnapshot) {
    const key = JSON.stringify([filter, target, snap.state, snap.analyzing, snap.transcript.length,
      snap.claims.map(({ id, state, verdict, open: expanded }) => [id, state, verdict, expanded]), [...flashIds]]);
    if (key === feedKey) return;
    feedKey = key;
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    feed.replaceChildren(...feedChildren(snap));
    flashIds = new Set();
    if (atBottom && !target) feed.scrollTop = feed.scrollHeight;
  }

  function renderFoot(snap: SessionSnapshot) {
    const buttons: HTMLButtonElement[] = [];
    if (snap.state === 'live' || snap.state === 'paused') {
      const stop = h('button', { class: 'btn danger', type: 'button' }, 'Stop');
      stop.addEventListener('click', () => void session.stop());
      buttons.push(stop);
    } else if (snap.state === 'ended') {
      const erase = h('button', { class: 'btn danger', type: 'button' }, 'Delete conversation');
      erase.addEventListener('click', () => void session.remove());
      const again = h('button', { class: 'btn primary', type: 'button' }, 'New check');
      again.addEventListener('click', () => void session.start());
      buttons.push(erase, again);
    }
    foot.hidden = buttons.length === 0;
    foot.replaceChildren(...buttons);
  }

  function render(snap: SessionSnapshot) {
    const attention = snap.claims.filter(isAttention).length;
    renderPill(snap, attention);
    renderHead(snap);
    renderSummary(snap, attention);
    renderFeed(snap);
    renderFoot(snap);
    if (attention !== badge) {
      badge = attention;
      transport.badge?.(attention);
    }
  }

  for (const [name, button] of Object.entries(tabButtons) as Array<[Filter, HTMLButtonElement]>) {
    button.addEventListener('click', () => {
      filter = name;
      target = null;
      render(session.snapshot());
    });
  }
  pauseButton.addEventListener('click', () => (session.snapshot().state === 'paused' ? session.resume() : session.pause()));
  minimize.addEventListener('click', () => setOpen(false));
  const clockTimer = window.setInterval(() => {
    if (session.snapshot().state === 'live') renderHead(session.snapshot());
  }, 1000);
  const onResize = () => setOpen(open, true);
  window.addEventListener('resize', onResize);

  document.documentElement.append(host);
  render(session.snapshot());
  setOpen(false, true);
  if (options.autoStart) void session.start();

  return {
    capture: source.capture,
    open: () => setOpen(true),
    toggle: () => setOpen(!open),
    destroy() {
      window.clearInterval(clockTimer);
      window.removeEventListener('resize', onResize);
      session.dispose();
      host.remove();
    },
  };
}

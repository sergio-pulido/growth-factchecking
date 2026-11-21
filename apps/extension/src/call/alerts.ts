// Verdict alerts while the panel is collapsed: stacked glass bubbles above the pill and an edge glow.
import type { Verdict } from '@growth-factcheking/shared';
import { NO_EVIDENCE, TONES, verdictPill } from './cards.js';
import { clock, h, icon } from './dom.js';
import type { ClaimItem } from './types.js';

const MAX = 3;
const GAP = 6;
const TTL_MS = 6500;
const FLASH: Record<Verdict, string> = {
  yes: '#2FD27A', probably_yes: '#2FD27A', neutral: '#F7B63C', probably_no: '#FF5247', no: '#FF5247',
};

export type VerdictAlert = { color: string; strong: boolean };

/** Colour alert for a verdict: true / false (and their "probably" forms) alert; neutral does not. */
export function verdictAlert(verdict: Verdict): VerdictAlert | null {
  if (verdict === 'neutral') return null;
  return { color: FLASH[verdict], strong: verdict === 'yes' || verdict === 'no' };
}

/** Makes the island jump and fill with the verdict colour, whether it is open or collapsed. */
export function popPanel(panel: HTMLElement, verdict: Verdict): boolean {
  const alert = verdictAlert(verdict);
  if (!alert || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  panel.style.setProperty('--pc', alert.color);
  panel.classList.remove('pop', 'soft', 'bump');
  void panel.offsetWidth; // restart the animation when verdicts arrive back to back
  panel.classList.add('pop');
  panel.classList.toggle('soft', !alert.strong);
  return true;
}

type Bubble = { id: string; el: HTMLDivElement; height: number; remaining: number; startedAt: number; timer: number };

export function createBubbles(container: HTMLElement, onOpen: (id: string) => void) {
  let list: Bubble[] = [];
  let hovered = false;

  function layout() {
    let offset = 0;
    list.forEach((bubble, index) => {
      const { el } = bubble;
      el.style.zIndex = String(100 - index);
      el.style.transform = `translateY(${-offset}px)`;
      el.style.opacity = index < MAX ? '1' : '0';
      el.style.pointerEvents = index < MAX ? 'auto' : 'none';
      if (index < MAX) offset += bubble.height + GAP;
    });
    container.style.height = `${Math.max(0, offset - GAP)}px`;
  }

  function run(bubble: Bubble) {
    bubble.startedAt = Date.now();
    window.clearTimeout(bubble.timer);
    bubble.timer = window.setTimeout(() => dismiss(bubble), bubble.remaining);
  }

  function hold(bubble: Bubble) {
    window.clearTimeout(bubble.timer);
    bubble.remaining = Math.max(800, bubble.remaining - (Date.now() - bubble.startedAt));
  }

  function dismiss(bubble: Bubble) {
    if (!list.includes(bubble)) return;
    window.clearTimeout(bubble.timer);
    list = list.filter((entry) => entry !== bubble);
    const { el } = bubble;
    el.style.pointerEvents = 'none';
    el.style.opacity = '0';
    el.style.transform += ' scale(.9)';
    window.setTimeout(() => el.remove(), 420);
    if (!list.length) hovered = false;
    layout();
  }

  function push(item: ClaimItem) {
    if (!item.verdict) return;
    const close = h('button', { class: 'b-x', type: 'button', 'aria-label': 'Dismiss' }, icon('close'));
    const first = item.sources[0];
    const evidence = first ? first.statementEn ?? first.statement : NO_EVIDENCE;
    const el = h('div', { class: 'bubble', role: 'status' },
      h('div', { class: 'b-content' },
        h('div', { class: 'b-top' }, verdictPill(item.verdict),
          h('span', { class: 'b-meta' }, `${item.speaker} · `, h('span', { class: 'mono' }, clock(item.at))), close),
        h('p', { class: 'b-claim' }, item.claim),
        h('p', { class: 'b-why' }, evidence.length > 140 ? `${evidence.slice(0, 139)}…` : evidence)));
    el.style.setProperty('--vc', `var(${TONES[item.verdict].color})`);
    const bubble: Bubble = { id: item.id, el, height: 0, remaining: TTL_MS, startedAt: 0, timer: 0 };
    el.addEventListener('click', (event) => {
      if ((event.target as Element).closest('.b-x')) {
        event.stopPropagation();
        dismiss(bubble);
        return;
      }
      onOpen(bubble.id);
    });
    el.style.transform = 'translateY(28px) scale(.55)';
    el.style.opacity = '0';
    container.append(el);
    bubble.height = el.offsetHeight;
    list = [bubble, ...list];
    list.slice(MAX + 2).forEach(dismiss);
    requestAnimationFrame(layout);
    if (!hovered) run(bubble);
  }

  container.addEventListener('mouseenter', () => {
    if (!list.length) return;
    hovered = true;
    list.forEach(hold);
  });
  container.addEventListener('mouseleave', () => {
    hovered = false;
    list.forEach(run);
  });

  return {
    push,
    clear() {
      [...list].forEach(dismiss);
    },
  };
}

export function flashScreen(el: HTMLElement, verdict: Verdict) {
  const alert = verdictAlert(verdict);
  if (!alert || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.style.setProperty('--fc', alert.color);
  const peak = alert.strong ? 1 : 0.75;
  el.animate(
    [{ opacity: 0 }, { opacity: peak, offset: 0.2 }, { opacity: peak, offset: 0.45 }, { opacity: 0 }],
    { duration: 1600, easing: 'ease-in-out' },
  );
}

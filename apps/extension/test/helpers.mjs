// Deterministic clock and scheduler for capture tests.
export const settle = () => new Promise((resolve) => setImmediate(resolve));

export function fakeClock(start = 0) {
  let time = start;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => time,
    scheduler: {
      setTimeout(fn, ms) {
        const id = ++nextId;
        timers.set(id, { at: time + Math.max(ms, 0), fn });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    pendingTimers: () => timers.size,
    /** Runs every timer due within `ms`, letting promises settle between them. */
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        await settle();
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].fn();
      }
      time = end;
      await settle();
    },
  };
}

/** In-memory ConversationApi that behaves like the real one (dedupe by clientId, 409 after end). */
export function fakeApi(overrides = {}) {
  const stored = [];
  const calls = { create: 0, send: [], end: 0 };
  let ended = false;
  const api = {
    stored,
    calls,
    async create() {
      calls.create++;
      return { ok: true, data: { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' } };
    },
    async sendUtterances(_id, utterances) {
      calls.send.push(utterances.map((u) => u.clientId));
      if (ended) return { ok: false, status: 409, message: 'Conversation has ended.' };
      const fresh = utterances.filter((u) => !stored.some((s) => s.clientId === u.clientId));
      stored.push(...fresh);
      return {
        ok: true,
        data: {
          accepted: fresh.length,
          duplicates: utterances.length - fresh.length,
          extraction: 'ok',
          claims: fresh.filter((u) => /\d/.test(u.text)).map((u, i) => ({
            id: String(stored.length + i), claim: u.text, speaker: u.speaker, utteranceClientId: u.clientId,
            status: 'checked', verdict: 'yes', sources: [],
          })),
        },
      };
    },
    async end() {
      calls.end++;
      ended = true;
      return { ok: true, data: null };
    },
    ...overrides,
  };
  return api;
}

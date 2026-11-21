# [GF-04] Argument relevance per claim — optional extra, not part of the MVP

Status: **implemented behind a flag that is off by default.** Not part of the MVP or the demo. Keep it out of the
demo unless the core (Meet capture → claims → verdicts) is finished and stable.
Evidence: [docs/evidence/2026-11-21-argument-relevance.md](../evidence/2026-11-21-argument-relevance.md).

Origin: Codex's proposal for Jaume and UX/UI on PR sergio-pulido/growth-factchecking#1 (branch
`codex/pitch-evaluation`, `docs/specs/argument-relevance-proposal.md`). This implements it in the conversations API
with the "paired" strategy that fixed the inconsistent answers seen in Codex's pilot.

## What it adds

An investor sees not only whether a claim is true, but whether it answers the question that was asked. Example
from the pitch: a true Eurostat figure gets **Sí · Relevancia baja** while the investor asked about July retention,
and **Sí · Relevancia alta** after the founder states a thesis about EU cloud adoption.

Optional field on each `ClaimCheck` (batch response and `GET /api/conversations/:id`):

```ts
argumentRelevance?: {
  status: 'assessed' | 'insufficient_context' | 'failed';
  level: 'high' | 'partial' | 'low' | null;            // null unless assessed
  context: { utteranceClientId; speaker; text } | null; // the question/thesis turn; null unless assessed
  reason: string;                                       // short Spanish copy, ready to show
}
```

`verdict`, `sources` and the fact-check `relevance` keep their meaning. Absent field = extra disabled.

## How it works

- Context: the 6 utterances before the claim's utterance (this batch plus earlier ones). Only turns with a question
  mark or an announced thesis ("mi/nuestra tesis", "my/our argument") can anchor; none → `insufficient_context`,
  no call.
- One Decisions call per claim (`ARGUMENT_RELEVANCE_MODEL`, default the Decisions model): a single choice over
  `sin_contexto` plus one option per anchor × level, so the cited turn and the level always agree.
- Runs in parallel with the fact-check of the same claim. A failure sets `status: "failed"` and never changes the
  verdict.

## Switching it on

```bash
cd /Users/nectios/workspace-os/hackathons/codex-devday-exchange/growth-factcheking
npm run db:migrate                       # adds nullable claims.argument_relevance (migration 005)
ARGUMENT_RELEVANCE_ENABLED=true npm run start:live --workspace @growth-factcheking/api
```

With the flag off (default) no query reads or writes `claims.argument_relevance`, no extra OpenAI call is made, and
the core works even where migration 005 was not applied. Unit tests cover this.

## Limits (from Codex's pilot and our runs)

- Questions without a question mark, a thesis inside the same turn, and topic changes are not handled yet.
- One scripted pitch (7 labelled claims); not an accuracy evaluation.
- Spanish reasons only.

## UI (when picked up)

The Meet capture controller already passes claims through unchanged, so the field reaches UX/UI without capture
changes. States to design (from the proposal): **No · Relevancia alta**, **Sí · Relevancia baja**,
**Neutral · Relevancia alta**, **Contexto insuficiente**; show `context.text` as the quoted question and `reason`.

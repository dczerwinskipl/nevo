---
review-of: task
change: ai-session-issues-and-diagnostics
task: canonical-cutover-and-cleanup
generated: 2026-09-06T19:55:00Z
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: ai-session-issues-and-diagnostics/canonical-cutover-and-cleanup

Baseline for this run: this file's own prior content (generated 2026-09-06T19:55:00Z,
verdict `pass`, reviewed at implementation `dde8c1ac6d077a53a6beab09d909834d364a455b`,
no unresolved findings recorded). This is a third pass, per the owner's second PR #41
follow-up. No baseline finding is stale/reopened — the prior pass had zero findings;
this pass evaluates the additional narrowing applied since (§ "Third pass" below).

## Verdict

`pass` — every acceptance criterion is met, the diff stays inside `allowed_paths`, and
no unresolved finding remains.

## Checklist

- [x] Acceptance criteria: 7/7
- [x] Scope: compliant
- [x] Findings: none unresolved

## Findings

No findings.

## Scope compliance

`git diff acb3a64dd7dc39c112ec78d7492b03cee52450e4..HEAD` for this task's cumulative
work (baseline `acb3a64`) touches only `tools/dashboard/server/ai/**`,
`tools/dashboard/ui/features/agent-sessions/**`, `tools/dashboard/tests/**`,
`docs/development/ai-sessions.md`, and `docs/decisions/**` — every path is inside
`allowed_paths`. No `forbidden_paths` (`src/**`, `tests/NEvo.*/**`) touched.

## Verification

Run fresh against implementation `e6e6c1160a905377dc91950aff5dcbc5b2608d52` (both
manually and via `node tools/specs.mjs self-check`, which recorded the same commands and
revision in `self_check`):

- `npm --prefix tools/dashboard test` — passed (809/809)
- `npm --prefix tools/dashboard run build` — passed
- `npm --prefix tools/dashboard run test:storybook` — passed (97/97)
- `node tools/specs.mjs validate` — passed
- `node tools/specs.mjs check` — passed
- `node tools/docs.mjs validate` — passed
- `node tools/docs.mjs check` — passed

## Acceptance-criteria coverage

- [x] All 7 acceptance criteria covered

## Architecture and documentation

This pass narrows two rules introduced in the prior pass (`d15ee14`) so neither is
broader than the actual captured protocol/contract evidence supports:

- **Antigravity terminal arbitration** (`tools/dashboard/server/ai/providers/antigravity/provider.mjs`):
  the diagnostic-residue override (a substantive, non-echoed final response overrides a
  terminal error) is now gated on `status === 'ERROR'` specifically, not any
  terminal-error signal. Every captured piece of evidence in this repo of a genuinely
  recoverable diagnostic (quota/rate-limit notice, a stale error re-emitted from a
  resumed conversation, a function-call-formatting retry notice) is `status: "ERROR"`
  with a substantive response. No captured evidence shows `status: "FAILED"` or a bare
  `is_error` flag (without `status: "ERROR"`) ever carrying a genuine recoverable
  response — every such captured case is a real current-turn failure with an empty
  response. `FAILED`/`is_error`-only/`TIMEOUT` therefore remain authoritative-fatal
  regardless of response text; only the evidenced status is ever reclassified. Genuine
  process-level fatal failure (non-zero exit without a prior terminal `result` event) is
  a structurally separate code path (`child.on('close')`) already gated by `isDone`/
  `isResolved`, unaffected by and independent of this narrowing.
- **SessionReadiness fail-closed** (`tools/dashboard/ui/features/agent-sessions/runtime/agent-session-runtime.ts`,
  `agent-event-reducer.ts`): `useAgentSessionRuntime` no longer falls open to
  `{ status: 'ready' }` when authoritative server readiness is unexpectedly absent after
  a snapshot has loaded. The new `resolveEffectiveReadiness(serverReadiness,
  optimisticPending)` helper fails closed to `MISSING_READINESS` (`status: 'unavailable'`,
  reason `readiness_unavailable`) instead — a missing/malformed readiness on an
  otherwise-loaded canonical snapshot or event is treated as a contract violation, never
  as license to start a turn. The one legitimate client-local override (optimistic-busy
  between a successful POST and the first authoritative `turn.updated`) is unchanged and
  still only ever makes readiness *more* restrictive, never less — matching ADR-0008's
  transport-optimism carve-out exactly. Single ownership of SessionReadiness
  (`resolveSessionReadiness` in `service.mjs`, shared identically by the HTTP snapshot
  and SSE `turn.updated` projection) from the prior pass is unchanged.
- Two stale comments describing a live "V1/V2 switch" that no longer exists were
  corrected (`agent-session-runtime-state.test.mjs`) — the historical task-11 title
  ("semantic Work chat V2", the task file's own real, still-current name) is left
  untouched, since it names a real historical fact, not live switch behavior.
- `agent-event-reducer.ts` was reviewed for a possible rename (it no longer reconstructs
  granular provider events). Kept as-is: `applyTurnUpdated` is still a genuine event
  reducer (folds one `turn.updated` SSE event into the turns array), so the name remains
  accurate; renaming would be a cosmetic move with no discoverability gain.

## Tests

- `tools/dashboard/tests/antigravity-provider.test.mjs`: the one test asserting a
  fabricated `status: "FAILED"` + response `=> completed` outcome (never grounded in
  captured evidence) now asserts the opposite — `FAILED` stays authoritative-fatal, the
  response is preserved as commentary, not promoted to FinalAnswer. Every other
  diagnostic-vs-fatal scenario (quota+response, stale-resumed-session+response,
  function-call-retry+response, generic-diagnostic+response, error-echoed-as-response,
  empty-response+ERROR, non-zero-exit-with-partial-tool-output, TIMEOUT+response) was
  already covered by the prior pass and re-verified green under the narrowed rule.
- `tools/dashboard/tests/agent-session-runtime-state.test.mjs`: added a dedicated
  regression test for `resolveEffectiveReadiness` proving: missing readiness fails
  closed (`unavailable`, composer disabled); missing readiness plus an optimistic send
  stays non-ready; a loaded authoritative `ready` enables send; an optimistic send
  immediately overrides an authoritative `ready`; the first authoritative event replaces
  the optimistic value with whatever the server actually reports; a later authoritative
  `ready` re-enables send.
- `tools/dashboard/tests/create-agent-session-helpers.test.mjs`: one existing test's
  mocked snapshot response was missing the (required) `readiness` field entirely — it
  only passed before because of the fail-open fallback this pass removes. Fixed the
  fixture to include a realistic `readiness: { status: 'ready', reason: 'idle' }` so it
  continues to test what it actually intends (turn-execution-failure vs.
  snapshot-load-failure error-domain separation), not the now-separately-tested
  missing-readiness behavior.

## Third pass

Two further, narrow corrections on top of `dde8c1a`:

- **SSE fail-closed on missing readiness** (`agent-session-runtime.ts`): the live
  `turn.updated` handler previously only called `setServerReadiness` when
  `event.readiness` was truthy, so a malformed event that omitted the (required)
  `readiness` field silently left whatever readiness was already in state — including a
  stale, possibly more permissive value. Every `turn.updated` now unconditionally sets
  `serverReadiness` to `event.readiness ?? null`, so a missing field clears to `null`
  and `resolveEffectiveReadiness` fails closed to `unavailable` rather than preserving
  stale state. Added a full hook-mounting regression test in
  `create-agent-session-helpers.test.mjs` (`MockEventSource` dispatching a real
  `turn.updated` message with `readiness` omitted) proving: ready → optimistic busy →
  turn.updated-without-readiness → `unavailable`/send disabled.
- **Task 13 source/manifest status sync**: `change.yaml` already had this task as
  `verified`; the task file's own frontmatter `status:` field still said `draft`.
  `computeTaskFingerprint`'s own doc comment (`tools/specs/fingerprint.mjs`) confirms
  this field is "simply never read" by any tool — no CLI command manages it (confirmed:
  no `tools/specs.mjs` subcommand writes task-file frontmatter), so there is no
  lifecycle command to route this through. Corrected by direct edit to `verified`,
  matching the same field on every other already-verified task in this change
  (`01`/`02`/`03`/`08`/`10`/`12`, which already carry the correct value) — not a
  generated index, so this isn't the hand-edit `AGENTS.md` warns against.

## Task 13 provenance

- Implementation SHA: `e6e6c1160a905377dc91950aff5dcbc5b2608d52` (on top of the prior
  passes' `d15ee14` and `dde8c1a`).
- `self_check`/`implementation.review_revision` updated to
  `e6e6c1160a905377dc91950aff5dcbc5b2608d52` via `node tools/specs.mjs self-check`
  (never hand-edited); `baseline_revision` unchanged
  (`acb3a64dd7dc39c112ec78d7492b03cee52450e4`); `changed_paths` unchanged from the prior
  pass (this pass touched only already-attributed files).
- `status` remains `verified` throughout, across all three passes — each is a
  re-evidencing pass on an already-verified task, never a fresh
  draft→implemented→verified transition.
- This review file and the `change.yaml`/generated-index updates above are committed as
  one bookkeeping commit, separate from and after the implementation commit — no
  self-referencing provenance.

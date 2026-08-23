---
id: chat-ux-improvements-pt1.semantic-chat-presentation-model
status: draft
change: chat-ux-improvements-pt1
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/src/lib/nevo-assistant-runtime.ts
    - tools/dashboard/src/lib/types.ts
    - tools/ai/contracts.mjs
    - tools/ai/transcript-cache.mjs
    - tools/ai/turn-runtime.mjs
    - tools/ai/claude-adapter.mjs
    - tools/ai/antigravity-adapter.mjs
    - tools/tests/claude-adapter.test.mjs
    - tools/tests/antigravity-adapter.test.mjs
    - tools/tests/ai-turn-runtime.test.mjs
    - tools/tests/ai-contracts.test.mjs
    - tools/dashboard/tests/ai-chat-helpers.test.mjs
    - tools/dashboard/tests/ai-contract-drift.test.mjs
  optional: []
semantic_references:
  decisions: [D6, D7, D11]
allowed_paths:
  - tools/dashboard/src/lib/**
  - tools/ai/contracts.mjs
  - tools/ai/transcript-cache.mjs
  - tools/ai/turn-runtime.mjs
  - tools/ai/claude-adapter.mjs
  - tools/ai/antigravity-adapter.mjs
  - tools/ai/mock-adapter.mjs
  - tools/tests/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
  - tools/dashboard/src/components/**
---

# Task: Establish semantic chat presentation model

## Goal

Create the pure, deterministic projection layer that turns already-fetched session
data into the Conversation/Work view-model every later task in this change consumes:
conversation turns, and per-turn Work with current/completed/failed activities — and
fix the tool terminal-status and turn/message-correlation defects discovered during
repository verification, which sit earlier in the pipeline than UI projection and
cannot be fixed there alone.

### Why this task's scope reaches into adapters and contracts

A verification pass (recorded in `owner-decisions.md` D6) found that "no explicit
successful completion was received" is not a sufficient description of the problem —
an explicit-looking success signal can itself be synthetic or wrong:

- **Claude adapter** emits a synthetic `tool.completed` at `content_block_stop`
  (`tools/ai/claude-adapter.mjs:348-357`) before the tool's real result is known, then
  a second, real `emitToolCompleted` call (with actual `status`) when the later
  `tool_result` block arrives (`claude-adapter.mjs:371-393`) — two terminal-looking
  signals per tool call.
- **Antigravity adapter**'s process-close handler emits a hardcoded
  `status: 'completed'` for any still-active tool (`tools/ai/antigravity-adapter.mjs:
  528-533`) **before** checking `operation.cancelled` (`:535-537`) and **before**
  checking a non-zero exit code (`:547-550`).
- **`AiTurnRuntime#emitToolCompleted`** (`tools/ai/turn-runtime.mjs:375-378`) reads
  only `{ toolId, output, durationMs }` — any `status` either adapter passes is
  silently dropped.
- **`contracts.mjs`'s validated `tool.completed` shape has no `status` field at all**
  (`tools/ai/contracts.mjs:364-370`), unlike `tool.updated` which does validate one
  (`:356-362`).
- **Restart/orphan recovery hits the same bug, not a different one.**
  `completeRunningToolCalls` (`tools/ai/transcript-cache.mjs:15-22`) unconditionally
  sets any `'running'` tool call to `'completed'`, and is called on `turn.completed`
  (`:309-310`), `turn.failed` (`:315`), **and** `markTurnInterrupted()` (`:93-114`,
  called from `AiTurnRuntime.reconcileOrphanedTurns()` after an ungraceful restart —
  `turn-runtime.mjs:629-652`).

Fixing this correctly requires one coherent semantic contract for a tool's terminal
state, owned end-to-end — not a downstream UI patch over an upstream contract that
cannot express the true outcome.

### Turn↔message correlation is also a verified prerequisite, not a given

`NormalizedMessage` (`tools/dashboard/src/lib/types.ts:383-400`) has no `turnId`
field. `applyAgentEvent` (`tools/dashboard/src/lib/nevo-assistant-runtime.ts`) reads
the raw event's `turnId` only to build a synthetic message `id` string (e.g.
`` `msg-${event.turnId || 'current'}` ``) and never stores it as a queryable field.
Per `owner-decisions.md` D7, this task must first verify (live and after reload) that
every message/tool/activity can be deterministically associated with its turn, and is
allowed the smallest structured model change needed to make that true — preferring an
explicit `turnId` (or equivalent stable turn-boundary metadata) on the normalized
projection over parsing display text or relying on the `id` string convention.

## D6 — tool terminal-status contract (decided: Option A)

`owner-decisions.md` D6 records the final decision: `tool.completed` is the single
terminal tool event and carries an explicit validated `status: 'completed' |
'failed'`. Implement:

- Reorder the Antigravity adapter's close handler so `operation.cancelled` and the
  process exit-code checks run **before** any terminal signal is emitted for a
  still-active tool, and derive that signal's `status` from those checks instead of
  hardcoding `'completed'`.
- Stop Claude's `content_block_stop` handler from emitting a signal that could be
  mistaken for the tool's real terminal outcome — it must not overwrite or race the
  later, real `tool_result`-driven outcome for the same `toolId`; only the
  `tool_result`-driven call is the terminal signal.
- Add a validated `status` field to `contracts.mjs`'s `tool.completed` shape.
- Make `turn-runtime.mjs#emitToolCompleted` accept and forward `status` instead of
  dropping it.
- Change `completeRunningToolCalls` (called from `turn.completed`, `turn.failed`, and
  `markTurnInterrupted()`/orphan recovery alike) to resolve a still-`'running'` tool
  call to `status: 'failed'`, never `'completed'`. This applies **regardless of the
  turn's own outcome** — the governing invariant is about the tool's own terminal
  signal, not the turn's: a tool is presented/persisted as successfully completed only
  when a real successful terminal tool outcome was received for that specific tool. A
  turn reaching normal `turn.completed` is not evidence that every tool lingering
  within it succeeded — a tool still `'running'` at that point, with no real
  `tool.completed{status:'completed'}` ever received for it, resolves to `'failed'`
  exactly like the failure/cancellation/orphan-recovery cases.

Do not add new per-tool statuses such as `'cancelled'` or `'interrupted'` —
`AgentToolCall.status` stays `'running' | 'completed' | 'failed'`. A finer-grained
distinction between "failed" and "cancelled/interrupted" is carried as turn-outcome
metadata (see Implementation constraints below and D9), not as a new tool-status
value.

This work is accepted in pt1 despite touching adapters/runtime/contracts because it
corrects existing lifecycle semantics required for truthful Work UX — it must not
expand into new provider capabilities, headless interaction protocols, orchestration,
deterministic-flow behavior, or provider session lifecycle redesign.

## Corrections from a follow-up review of PR #35

Three defects were found in this task's first implementation pass, all in code this
task owns (`chat-projection.ts`, `transcript-cache.mjs`, `nevo-assistant-runtime.ts`):

1. **Work's status model conflated lifecycle with outcome.** The projection's
   `computeWorkStatus` checked "any item failed" before checking "is this turn still
   active," so a single failed historical action inside an otherwise still-running turn
   forced the whole Work group into a terminal `'failed'` state — even while another
   action in the same turn was still `'running'`. Corrected: lifecycle (`'current'` vs.
   terminal) is now determined first and only from whether the turn is still active or
   has a `'running'` item, never from whether any item failed; a turn's `TurnWork` gains
   an independent `hasFailures: boolean` field so "does this Work need attention" and
   "has this turn terminated" are tracked separately. A valid active turn can look like
   `Read failed`, `Bash completed`, `Edit running` and must stay `status: 'current'`
   with `hasFailures: true`.
2. **Terminal cleanup was not scoped to the terminating turn.** Both
   `completeRunningToolCalls` (`transcript-cache.mjs`) and the frontend reducer's
   `turn.completed`/`turn.failed` handling swept *every* message's `'running'` tool
   calls, not only the ones belonging to the turn that actually just ended. The
   single-active-turn invariant means this was not reachable in practice, but the
   scoping was implicit, not enforced. Corrected: both now take the terminating event's
   `turnId` and only resolve tool calls on messages whose own `turnId` matches — a
   terminal event for one turn can never mutate a different turn's still-`running`
   actions, explicit and tested rather than relying on the invariant alone.
3. **The frontend reducer's turn/message correlation was corrected to preserve explicit
   message identity.** `applyAgentEvent`'s event-dispatch logic previously searched by
   `turnId` first, merging all events for a turn into a single `NormalizedMessage`
   regardless of explicit `messageId` values. Corrected: events are now correlated by
   explicit `messageId` first — when an event explicitly names a `messageId`, that
   identity is preserved and two distinct events in the same turn with different
   `messageId`s produce two separate `NormalizedMessage` records. `turnId` is only a
   fallback, for events (e.g. `tool.started`/`tool.completed`) that carry no explicit
   `messageId`. Work de-duplication belongs in the projection layer, not in the reducer:
   `chat-projection.ts#projectChat` now aggregates all messages sharing a `turnId` into
   exactly one `TurnWork`, regardless of how many individual messages a turn produced.
   The invariant is **Work is per-turn** (one `TurnWork` per `turnId`), not "one turn =
   exactly one assistant message" — a turn may legitimately produce multiple assistant
   messages when the provider emits distinct `messageId` values for separate content
   segments.

## Implementation constraints

- Follow `docs/development/react-component-guidelines.md` §6 ("keep data
  transformation out of JSX") and §9.2 (view models built close to their data source)
  for the frontend projection half of this task — it is a library module, not
  something computed inline inside a component.
- Do not invent a new `AgentToolCall.status` value beyond the existing `'running' |
  'completed' | 'failed'` (`types.ts:379`) — per D6, a turn-level distinction between
  "failed" and "cancelled/interrupted" is carried as turn-outcome metadata (the
  existing `turn.failed` `error.code` — `AI_TURN_CANCELLED`/`AI_TURN_INTERRUPTED`/
  `AI_TURN_TIMEOUT`/`AI_PROVIDER_EXIT_ERROR`, `contracts.mjs:400-405`), not as a new
  per-tool status value. This task must plumb that existing `error.code` through to
  the projection output (it is validated on the wire today but not currently exposed
  on `NormalizedMessage`/the session snapshot in a reload-safe way) so Task 09 can
  distinguish Turn/Work Outcomes without needing backend access itself (see
  `owner-decisions.md` D9).
- Turn/message correlation (D7): verify with evidence (existing or new tests) whether
  one turn ever produces more than one `NormalizedMessage`, and under what conditions.
  If an explicit `turnId` (or equivalent) is added to `NormalizedMessage`, it must
  survive persistence/reload (`tools/ai/transcript-cache.mjs`), not just the live SSE
  path.
- No deterministic-workflow behavior changes (`tools/specs.mjs start` /
  `autoBindAgentSession` is untouched by this task).
- No new provider capability.
- Do not regex or otherwise parse assistant message text to infer task/subagent
  semantics (FR-7) — the projection only acts on structured event/message fields.
- Existing tests already partially cover this surface —
  `tools/tests/claude-adapter.test.mjs` (has fixtures using `content_block_stop`/
  `tool_result` and an `emitToolCompleted` spy already, e.g. around line 608),
  `tools/tests/antigravity-adapter.test.mjs`/`tools/tests/process-termination.test.mjs`
  (child-process close/exit-code simulation helpers already exist), and
  `tools/tests/ai-turn-runtime.test.mjs` (already has `reconcileOrphanedTurns` cases
  around line 414+). Extend these rather than duplicating their fixture setup in a new
  file where an existing one already models the same scenario.

## Acceptance criteria

**Tool terminal-status contract (D6, Option A):**

1. Antigravity's close handler checks `operation.cancelled` and the process exit code
   **before** determining the outcome of any still-active tool at close time; no path
   hardcodes `status: 'completed'` for a tool that was active when the process closed
   during a cancellation or non-zero exit.
   `automated: node --test tools/tests/antigravity-adapter.test.mjs`
2. Claude's premature `content_block_stop` signal can never cause a later, real
   `tool_result`-driven outcome for the same `toolId` to be lost or overwritten with a
   stale/synthetic success.
   `automated: node --test tools/tests/claude-adapter.test.mjs`
3. A tool call still `'running'` when a turn ends resolves to `status: 'failed'` —
   never `'completed'` — regardless of *how* the turn ended: `turn.failed`,
   cancellation, `markTurnInterrupted()`/orphan recovery, **and normal `turn.completed`
   while that specific tool never received a real successful terminal signal**. A
   successful turn outcome is not evidence that every lingering tool succeeded.
   `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
4. `contracts.mjs`'s `tool.completed` shape validates an explicit `status: 'completed'
   | 'failed'` field, `turn-runtime.mjs#emitToolCompleted` forwards it, and both
   adapters and the frontend reducer consume it consistently — implemented across the
   whole wire, not partially on one side.
   `automated: node --test tools/tests/ai-contracts.test.mjs && npm --prefix tools/dashboard test`

**Turn/message correlation (D7):**

5. The turn↔message correlation is verified against real event sequences (existing
   fixtures/tests or new ones) and documented in the projection module; ambiguous
   cases have a stated deterministic fallback.
   `inspection: read the projection module's doc comment and its test fixtures for at least one multi-tool-call turn`
6. If a structural change was needed to make correlation deterministic (e.g. an
   explicit `turnId` on `NormalizedMessage`), it survives persistence/reload, verified
   by a test that reloads a session rather than only observing the live stream.
   `automated: node --test tools/tests/ai-turn-runtime.test.mjs && npm --prefix tools/dashboard test`

**Projection layer:**

7. A documented function (or small set of functions) exists that takes the current
   session's data and returns conversation entries and per-turn Work
   (current/completed/failed), consuming whatever turn-outcome metadata this task now
   exposes.
   `automated: npm --prefix tools/dashboard test`
8. Raw technical details (toolName, input, output, duration, status) remain present
   and accessible on the projection's output — normalization/labeling is deferred to
   Task 04.
   `inspection: confirm the projection's Work item type still exposes toolName/input/output/status/durationMs`
9. `tools/dashboard/tests/ai-contract-drift.test.mjs` continues to pass — no
   accidental drift between `tools/ai/contracts.mjs` and
   `tools/dashboard/src/lib/types.ts`.
   `automated: npm --prefix tools/dashboard test`

**Corrections from a follow-up review of PR #35:**

19. An active turn containing a mix of completed, failed, and running actions stays
    `status: 'current'` (never forced to terminal `'failed'` by the earlier failure);
    the projection's `hasFailures` field reflects the failure independently of
    lifecycle.
    `automated: npm --prefix tools/dashboard test`
20. A terminal event (`turn.completed`/`turn.failed`) for one turn never resolves a
    still-`'running'` tool call belonging to a different turn, in both
    `transcript-cache.mjs#completeRunningToolCalls` and the frontend reducer.
    `automated: npm --prefix tools/dashboard test`
21. Every assistant-message-producing event for one `turnId` (reasoning, text, and any
    number of tool calls) correlates to exactly one assistant message — never a split
    "Work-only" message plus a separate "prose" message for the same turn.
    `automated: npm --prefix tools/dashboard test`

**Required test scenarios (from `owner-decisions.md` D6):**

10. Successful Claude tool execution.
11. Failed Claude tool result.
12. Claude tool lifecycle does not complete merely because the `tool_use` content
    block finished.
13. Successful Antigravity tool.
14. Antigravity cancellation while a tool is active.
15. Antigravity non-zero exit while a tool is active.
16. Turn-level failure with an active tool.
17. **A turn reaching normal `turn.completed` while a different tool call in the same
    turn is still `'running'` and never received a real successful terminal signal —
    that tool resolves to `'failed'`, not `'completed'`, even though the turn itself
    succeeded.** This is a distinct scenario from 16 (turn-level failure) — here the
    turn itself is fine; only one lingering tool within it is unresolved.
    `automated: node --test tools/tests/ai-turn-runtime.test.mjs`
18. Live event projection and a persisted/reloaded transcript produce the same
    semantic result for every scenario above.
    `automated: node --test tools/tests/claude-adapter.test.mjs tools/tests/antigravity-adapter.test.mjs tools/tests/ai-turn-runtime.test.mjs tools/tests/ai-contracts.test.mjs && npm --prefix tools/dashboard test`

## Verification

```text
node --test tools/tests/claude-adapter.test.mjs
node --test tools/tests/antigravity-adapter.test.mjs
node --test tools/tests/ai-turn-runtime.test.mjs
node --test tools/tests/ai-contracts.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- Rendering the Work/Conversation view-model in the UI — Tasks 02 (conversation) and
  03 (Work) consume this task's output; this task ships no visible UI change.
- Human-readable activity labels — Task 04.
- Session details / spec / task association data — Task 06 (unrelated data source;
  see `owner-decisions.md` D5).
- Introducing a `stopped` session-activity value, or any `AgentToolCall.status` value
  beyond `'running' | 'completed' | 'failed'` — see `owner-decisions.md` D6/D9.
- New provider capabilities, headless interaction protocols, orchestration,
  deterministic-flow behavior, or provider session lifecycle redesign.

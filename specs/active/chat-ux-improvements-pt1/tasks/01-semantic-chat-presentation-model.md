---
id: chat-ux-improvements-pt1.semantic-chat-presentation-model
status: draft
change: chat-ux-improvements-pt1
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - specs/active/chat-ux-improvements-pt1/areas/react-component-guidelines.md
    - tools/dashboard/src/lib/nevo-assistant-runtime.ts
    - tools/dashboard/src/lib/types.ts
    - tools/ai/contracts.mjs
    - tools/ai/transcript-cache.mjs
    - tools/ai/turn-runtime.mjs
    - tools/dashboard/tests/ai-chat-helpers.test.mjs
    - tools/dashboard/tests/ai-contract-drift.test.mjs
  optional: []
allowed_paths:
  - tools/dashboard/src/lib/**
  - tools/ai/transcript-cache.mjs
  - tools/ai/turn-runtime.mjs
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
  - tools/ai/contracts.mjs
  - tools/dashboard/src/components/**
---

# Task: Establish semantic chat presentation model

## Goal

Create the pure, deterministic projection layer that turns already-fetched session
data (`AgentSessionSnapshot`, `NormalizedMessage[]` from `useNevoAssistantRuntime`,
`tools/dashboard/src/lib/nevo-assistant-runtime.ts:374-709`) into the Conversation/Work
view-model every later task in this change consumes: conversation turns, and per-turn
Work with current/completed/failed activities.

Discovery confirms no new backend aggregate or wire-format change is required for this
grouping: every event already carries `turnId` (`tools/ai/contracts.mjs:317`), and tool
calls already fold under the owning `NormalizedMessage` via `applyAgentEvent`
(`nevo-assistant-runtime.ts:84-239`). This task's first acceptance criterion is to
confirm and document that correlation precisely (does exactly one turn ever produce more
than one `NormalizedMessage`? under what conditions?) — this is the "documented
deterministic fallback" FR-3 requires for ambiguous cases, not something to assume.

This task also fixes the abrupt-mid-tool-failure defect recorded in
`owner-decisions.md` D6: currently, when a turn ends (`turn.completed`/`turn.failed`)
while a tool call is still `'running'`, both `applyAgentEvent`'s turn-ending handling
(`nevo-assistant-runtime.ts:225-234`) and the backend's `completeRunningToolCalls`
(`tools/ai/transcript-cache.mjs:15`) force that tool call to `'completed'` regardless of
how the turn ended. Fix wherever the incorrect status is actually assigned — check both
sites; do not assume only one is responsible.

## Implementation constraints

- Follow `areas/react-component-guidelines.md` §6 ("keep data transformation out of
  JSX") and §9.2 (view models built close to their data source) — this projection is a
  library module, not something computed inline inside a component.
- Do not change `tools/ai/contracts.mjs`'s validated event shapes. `tool.updated`'s
  `status` field is already an unconstrained string (`contracts.mjs:361`) — if the fix
  needs a new status value on the wire, it can be emitted as an already-valid string
  without a schema change. If investigation shows a schema change actually is required,
  stop and escalate per `docs/ai/specification-workflow.md`'s escalation rule instead of
  silently widening `allowed_paths`.
- Do not invent a status value beyond what current signals justify (FR-4's "do not
  invent new provider states the runtime cannot actually distinguish"). Before choosing
  the resulting value, check what's actually knowable: was an explicit `tool.updated{
  status:'failed'}` ever emitted for this tool? did the turn end via `turn.failed`,
  cancellation (`AI_TURN_CANCELLED`), or `turn.completed`? Prefer reusing the existing
  `'failed'` value for "never completed successfully, turn did not end cleanly" unless
  investigation shows a genuine need for a distinct value — record the reasoning in the
  task's own notes/tests, not just the code.
- No deterministic-workflow behavior changes (`tools/specs.mjs start` /
  `autoBindAgentSession` is untouched by this task).
- No new provider capability.
- Do not regex or otherwise parse assistant message text to infer task/subagent
  semantics (FR-7) — the projection only acts on structured event/message fields.

## Acceptance criteria

1. A documented function (or small set of functions) exists that takes the current
   session's `NormalizedMessage[]` (plus whatever turn-boundary data is already
   available) and returns conversation entries and per-turn Work (current/completed/
   failed), without requiring a new backend endpoint or event shape.
   `automated: npm --prefix tools/dashboard test`
2. The exact turn↔message correlation (one turn → one message, or one turn → many) is
   verified against real event sequences (existing fixtures/tests or new ones) and
   documented in the module; ambiguous cases have a stated deterministic fallback.
   `inspection: read the projection module's doc comment and its test fixtures for at least one multi-tool-call turn`
3. A tool call that never received an explicit successful `tool.completed`/`tool.updated{status:'completed'}`, in a turn that ended via `turn.failed` or cancellation, is never represented by the projection as `'completed'`.
   `automated: npm --prefix tools/dashboard test`
4. The fix in AC 3 is verified at both sites found during discovery — the frontend
   reducer (`nevo-assistant-runtime.ts`) and the backend transcript cache
   (`tools/ai/transcript-cache.mjs`) — with a test covering at least the backend
   persistence path (a session reloaded after an abrupt failure still shows the correct
   status, not just the live-stream path).
   `automated: npm --prefix tools/dashboard test`
5. Raw technical details (toolName, input, output, duration, status) remain present and
   accessible on the projection's output — normalization/labeling is explicitly deferred
   to Task 04, this task does not lose or rewrite the raw fields.
   `inspection: confirm the projection's Work item type still exposes toolName/input/output/status/durationMs`
6. `tools/dashboard/tests/ai-contract-drift.test.mjs` continues to pass — no accidental
   drift between `tools/ai/contracts.mjs` and `tools/dashboard/src/lib/types.ts`.
   `automated: npm --prefix tools/dashboard test`
7. New projection logic has focused unit tests covering: a clean multi-tool successful
   turn, a turn with one failed tool among successes, and the abrupt-termination case
   from AC 3-4.
   `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
```

## Out of scope

- Rendering the Work/Conversation view-model in the UI — Tasks 02 (conversation) and 03
  (Work) consume this task's output; this task ships no visible UI change.
- Human-readable activity labels — Task 04.
- Session details / spec / task association data — Task 06 (unrelated data source).

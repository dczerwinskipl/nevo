---
id: spec.chat-ux-improvements-pt1
type: change
title: "Chat UX Improvements pt1"
status: draft
change: chat-ux-improvements-pt1
---

# Chat UX Improvements pt1

## Context

The Nevo dashboard's AI chat (`AiChatPage`, `tools/dashboard/src/components/ai-chat.tsx`)
currently reads as a raw provider-event viewer: one card per tool call, uppercase status
badges, avatars consuming mobile width, a header carrying mode/delete/provider chrome,
and unconditional `scrollIntoView`-style auto-scroll on every event. This change
reorganizes it into a conversation-first workspace — Conversation, Work, and Session
Context — per the product/UX brief recorded as the basis for this change (see
`owner-decisions.md` D1). The Spec Writer's job here was repository discovery, mapping
the brief onto the current implementation, and surfacing genuine implementation
contradictions the brief could not have known about — not re-opening product scope
(`owner-decisions.md` D1).

This overview was corrected on 2026-08-21 after a review of PR #35 found that the
first pass under-scoped two problems (tool terminal-status correctness, and
session→task binding persistence) by describing them as smaller/more local than the
evidence actually supports, and conflated two distinct concepts (Session Activity vs.
Turn/Work Outcome). D5 and D6 were then finalized the same day — D5 as Option A
(aggregate existing binding rows) and D6 as Option A (`tool.completed` carries an
explicit terminal `status`).

A second, same-day review found D5's aggregation key was still incomplete (grouping by
`(provider, providerSessionId)` alone can merge task IDs from *unrelated
specifications* into one "current spec" view — see D10) and reversed the prior "do not
touch `AiSessionStatus`" conclusion once explicitly authorized to widen Task 09's scope
for that one purpose (see D9's second correction). See `owner-decisions.md` D5-D10 for
the full analysis and final decisions; this file reflects the fully decided state
throughout, not any of the intermediate framings.

## Current architecture

Grounded in three discovery passes (frontend, backend/events, and a focused
verification pass against specific adapter/runtime/persistence code) against the
current repository state:

**Frontend** — `AiChatPage` (`ai-chat.tsx:140-495`) is a single ~500-line component
wrapping `AssistantRuntimeProvider` fed by `useNevoAssistantRuntime`
(`tools/dashboard/src/lib/nevo-assistant-runtime.ts:374-709`). It inlines the message
list, header, and composer directly in its JSX — there is no separate `ChatHeader`,
`Composer`, or `MessageList` component. Messages render via a local `ChatMessage`
function (`ai-chat.tsx:44-80`) using literal `Bot`/`User` icons as avatars (no image/
initials logic), `react-markdown`+`remark-gfm` for assistant text only
(`components/markdown-content.tsx`), and plain `whitespace-pre-wrap` for user text with
no collapse behavior. Each tool call renders as its own independent card via
`AiToolView` (`components/ai-tool-view.tsx:10-90`) — `message.toolCalls?.map(...)`
(`ai-chat.tsx:62-64`) with no grouping or collapsing of consecutive calls. Auto-scroll
is unconditional (`ai-chat.tsx:193-195`, a `useEffect` calling `scrollTo` on every
`assistant.messages`/`pendingInteraction`/`submissionError` change) with no near-bottom
detection. No Dialog/Sheet/Drawer primitive exists anywhere in the project — every
existing modal (`CreateAiSessionDialog`, `ai-chat.tsx:497-532`; similar in
`spec-actions.tsx`/`spec-detail.tsx`) is a hand-rolled `fixed inset-0` overlay; only
`@radix-ui/react-slot` is present in `tools/dashboard/package.json`.

**Backend/events** — Chat sessions, messages, and tool events are modeled entirely in
Node.js under `tools/ai/*.mjs` (contracts in `tools/ai/contracts.mjs`, no `src/NEvo.*`
.NET involvement in this data path). Transport is REST for snapshot/commands plus SSE
for live events (`tools/dashboard/server/ai-routes.mjs`). Every raw `AgentEvent`
carries `turnId` (`types.ts:477`), but it is not propagated onto the persisted
`NormalizedMessage` — `applyAgentEvent` only uses it to build a synthetic message `id`
string (`nevo-assistant-runtime.ts`, e.g. `` `msg-${event.turnId || 'current'}` ``),
never as a queryable field (`owner-decisions.md` D7). There is no existing first-class
"Work"/turn-grouping aggregate.

**Tool terminal status — verified end-to-end, not just at the UI boundary**
(`owner-decisions.md` D6): the Claude adapter emits a synthetic, status-less
`tool.completed` at `content_block_stop` (`tools/ai/claude-adapter.mjs:348-357`)
*before* the tool's real result is known, then a second, real `emitToolCompleted` call
when the later `tool_result` block arrives (`claude-adapter.mjs:371-393`) — two
terminal-looking signals per tool call. The Antigravity adapter's process-close
handler emits a hardcoded `status: 'completed'` for any still-active tool
(`tools/ai/antigravity-adapter.mjs:528-533`) *before* checking `operation.cancelled`
(`:535-537`) or a non-zero exit code (`:547-550`). Even when an adapter does pass a
real `status` (including `'failed'`) to `emitToolCompleted`,
`AiTurnRuntime#emitToolCompleted` (`tools/ai/turn-runtime.mjs:375-378`) reads only
`{ toolId, output, durationMs }` and silently drops it — and `contracts.mjs`'s
validated `tool.completed` shape has no `status` field at all (`contracts.mjs:
364-370`), unlike `tool.updated` which does validate one (`:356-362`). Restart/orphan
recovery hits the identical bug, not a separate one:
`completeRunningToolCalls` (`tools/ai/transcript-cache.mjs:15-22`) unconditionally
sets any `'running'` tool call to `'completed'`, and is called from `turn.completed`
(`:309-310`), `turn.failed` (`:315`), and `markTurnInterrupted()`
(`:93-114`, invoked by `AiTurnRuntime.reconcileOrphanedTurns()` after an ungraceful
restart — `turn-runtime.mjs:629-652`).

**Session↔spec/task association — the storage is already one-to-many; the readers
collapse it, and binding is also cross-spec-capable in a way that must not be
merged** (`owner-decisions.md` D5, D10): `AgentSessionBindingService`
(`tools/ai/binding-service.mjs:23-525`) persists to `.nevo-ai-local/sessions/
<specId>.json` — **one file per spec**. It already stores one row per task for a
given `(provider, providerSessionId, specId)` — `bindSession`/`bindSessionSync`
(`:252-331`, `:333-409`) push a new row when no exact match exists, and
`listBindings`/`listBindingsSync` (`:453-462`, `:464-473`) already return the full
multi-row array *for one spec's file*. Neither function ever checks or replaces a
binding in a *different* spec's file, so **the same `(provider, providerSessionId)`
can legitimately hold rows under more than one spec** — e.g. a long-lived agent CLI
session that runs commands against change A and later change B via
`autoBindAgentSession` (`tools/specs.mjs:52-73`, called from nearly every
`tools/specs.mjs` command touching a change), or an explicit `agent-session attach` to
a different spec (`tools/specs.mjs:1793-1810`). `getBinding(provider,
providerSessionId)` (`binding-service.mjs:475-480`) already has to cope with this
today, and does so arbitrarily — it loads *every* spec's file
(`readdir(storageDir)`-ordered, not recency-ordered) and returns the first match.
Neither `AiSessionService` (`tools/ai/service.mjs`) nor `tools/dashboard/server/
ai-routes.mjs` ever aggregates multiple rows into a logical session; every consumer
calls `getBinding`. `AiSessionService.createSession` (`service.mjs:22`) also
independently fails to fan out a multi-element `taskIds` into more than one
`bindSession` call. Fixing the multi-task display bug therefore requires the
aggregation to be **spec-scoped** — `(provider, providerSessionId, specId)`, not
`(provider, providerSessionId)` alone — or it would merge unrelated specs' task IDs
into one view (D10). There is no reassignment endpoint — `PATCH
/api/agent-sessions/:provider/:providerSessionId` only changes `mode`
(`ai-routes.mjs:292-301`). Two parallel API surfaces exist: the current
`/api/agent-sessions/...` surface (`nevo-assistant-runtime.ts`) and a server-labeled
`/api/ai/...` "legacy" surface (`ai-routes.mjs:87-89`) still used for session
create/delete (`hooks/use-dashboard-data.ts`, wired into `ai-chat.tsx:29-31`).

**Session Activity vs. Turn/Work Outcome — two concepts, not one vocabulary; the
declared type was wider than its live producer, and is now narrowed to match**
(`owner-decisions.md` D9): `AiSessionService.resolveSessionActivity()`
(`service.mjs:83-112`) computes only `idle | running | waitingForUser` —
`AiSessionStatus` (`types.ts:346`) currently *declares* `'idle' | 'running' |
'waitingForUser' | 'completed' | 'failed'`, 5 members, but no producer anywhere emits
`'completed'`/`'failed'` (a turn ending any way — success, failure, cancellation —
always leaves the session at `idle`), and no evidence was found that those two members
are reserved for an imminent concrete contract (no `completedAt` producer, no comment
indicating intent — see D9). Two real consumers still check them defensively —
`ai-chat.tsx:457,465,482` (composer-disable logic) and `ai-session-list.tsx:
116,128,234-235,46` (status icon, badge tone, `statusLabel`, and a current/completed
list split that can never actually split anything) — both dead code today, not merely
unused declarations. Task 09 removes both the type members and the branches that check
them (D9's second correction), rather than preserving harmless-but-misleading dead
code. How a turn ended is separate, existing metadata: `turn.failed` validates `error:
{ code, message }` (`contracts.mjs:400-405`) with existing codes including
`AI_TURN_CANCELLED`, `AI_TURN_INTERRUPTED`, `AI_TURN_TIMEOUT`, `AI_PROVIDER_EXIT_ERROR`
(`turn-runtime.mjs`) — validated on the wire today but not currently exposed on
`NormalizedMessage`/the session snapshot in a way that survives reload.

**Session→task association at the actual HTTP boundary, spec-scoped** (`owner-decisions.md`
D5, D10): the single-session GET route (`tools/dashboard/server/ai-routes.mjs:315-350`,
serving both `/api/agent-sessions/:provider/:providerSessionId` and the legacy
`/api/ai/sessions/:provider/:providerSessionId` alias — the exact route
`fetchAgentSessionSnapshot` calls) builds its response with `taskId: binding?.taskId`
only, calling `getBinding` directly. `AiSessionService.listSessions`
(`service.mjs:52-66`) maps each raw binding row into its own list entry with no
grouping at all. Both must change for D5's Option A aggregation to be observable by
the dashboard, not just internally correct — and per D10, the grouping key must be
`(provider, providerSessionId, specId)`: the single-session route picks the binding
row with the most recent `lastSeenAt` across all of a provider session's specs as
"current," then aggregates `taskIds[]` only from rows sharing that row's `specId`.

## Problem

The current architecture cannot present a conversation-first view without either
(a) rendering every raw tool event as a first-class card, which is the exact problem
this change fixes, or (b) inventing per-turn Work grouping and human-readable labels
on the fly inside JSX, which the current component already does not do cleanly (no
existing precedent for grouping beyond message-boundary folding). It also has data
correctness/completeness gaps discovered during repository mapping and a second
verification pass that block correct display of data this change's UI already needs
and cannot be fixed by UI projection alone:

1. **Session→task association** (`owner-decisions.md` D5, **decided — Option A**): the
   service layer never fans out or aggregates a session's multiple task associations,
   even though the underlying binding storage already supports one row per task. Fixed
   by aggregating the existing storage (`createSession` fans out to one `bindSession`
   call per task; session assembly reads via `listBindings` instead of `getBinding`) —
   not by migrating the persisted shape — see D5. **The aggregation key must be
   spec-scoped** (`owner-decisions.md` D10, **decided — Option C**): the same provider
   session can legitimately hold binding rows under more than one specification
   (storage is partitioned per spec, and binding never replaces a prior spec's row),
   so aggregating by `(provider, providerSessionId)` alone would merge unrelated
   specs' task IDs into one "current specification" view. Fixed by aggregating within
   `(provider, providerSessionId, specId)`, with the most-recently-bound spec chosen
   deterministically as "current" — no deterministic-flow change, no new persisted
   field — see D10.
2. **Tool terminal status** (`owner-decisions.md` D6, **decided — Option A**): two
   adapters can each produce a terminal-looking signal that misrepresents a tool's
   actual outcome (premature synthetic success, hardcoded success ahead of
   cancellation/exit checks, a dropped `status` field, and identical mishandling during
   restart/orphan recovery). This directly blocks FR-4 (Work failure visibility) and
   cannot be fixed downstream in UI projection, because the wire contract itself cannot
   currently express "this tool failed" in `tool.completed`. Fixed by making
   `tool.completed` a true terminal event carrying an explicit validated
   `status: 'completed' | 'failed'` — see D6.
3. **Turn↔message correlation** (`owner-decisions.md` D7, decided): assumed available
   for free from `NormalizedMessage[]`; verification shows `NormalizedMessage` has no
   `turnId` field, so this must be proven and possibly given a small structural fix,
   not assumed.

## Constraints

- No deterministic-workflow behavior change: `tools/specs.mjs start` →
  `autoBindAgentSession` (`tools/specs.mjs:52-73,104`) and the `agent-session attach`
  CLI path (`tools/specs.mjs:1793-1810`) are out of scope; this change only changes how
  the *result* of that binding is displayed and (per D5) how faithfully it is
  aggregated, never how/when a task auto-binds a session. This is the specific
  constraint D10's Option C was chosen to satisfy — `bindSession`/`autoBindAgentSession`
  are unmodified; the fix is entirely on the read/aggregation path.
- Aggregation of a session's task associations is **spec-scoped**:
  `(provider, providerSessionId, specId)`, never `(provider, providerSessionId)`
  alone — the same provider session can legitimately hold binding rows under more
  than one specification, and merging across specs would leak unrelated tasks into
  Session details' "current specification" view (`owner-decisions.md` D10). "Current
  spec" is chosen deterministically (most recent `lastSeenAt`), not arbitrarily.
- No new provider capability, headless interaction protocol, or subagent execution
  support (brief §3.3).
- **Session Activity** — the only values any task may treat as live/producible:
  `idle | running | waitingForUser`. `AiSessionStatus`
  (`tools/dashboard/src/lib/types.ts:346`) is narrowed by Task 09 to exactly these
  three — the legacy `'completed'`/`'failed'` members (no current producer, no
  evidence of intentional retention for a future contract) are removed, along with the
  dead branches that checked them in `ai-chat.tsx` and `ai-session-list.tsx`
  (`owner-decisions.md` D9, second correction). Do not invent a `stopped` value.
  **Turn/Work Outcome** (`successful | failed | cancelled/interrupted`) is a separate
  concept, sourced from existing turn-level `error.code` metadata, not a new
  session-activity value (`owner-decisions.md` D9).
- Do not invent a new `AgentToolCall.status` value beyond `'running' | 'completed' |
  'failed'` (`types.ts:379`) — a failed-vs-cancelled distinction is carried as
  turn-outcome metadata, not a new per-tool status (`owner-decisions.md` D6/D9).
- New external dependency: `@radix-ui/react-dialog` only (`owner-decisions.md` D3) — no
  other general-purpose UI/component framework (see
  `docs/development/react-component-guidelines.md` §2.3, §30).
- All frontend tasks in this change are additionally governed by the durable
  `docs/development/react-component-guidelines.md` (component sizing/composition,
  projection outside JSX, view-model update-boundary discipline, memoization,
  accessibility, Radix-wrapper conventions) — required reading for every task listed
  below, cited directly (no separate spec-local index — see "Areas").
- Reuse `ux-improvements-version-1`'s verified `design-tokens` task and its in-flight
  `shared-status-label-component`/`mode-description-tooltip`/`task-session-linking`
  tasks rather than reinventing chat-local equivalents — coordinated as a
  pre-implementation preflight, not left to Task 11 alone (`owner-decisions.md` D8;
  see "Overlap preflight" below).
- D5, D6, and D10 are all decided (`owner-decisions.md`) — Task 01 and Task 06 are no
  longer gated on an open decision; implement the recorded directives directly.

## Affected modules

- `tools/dashboard/src/components/ai-chat.tsx` (message list, header, composer — split
  across tasks)
- `tools/dashboard/src/components/ai-tool-view.tsx`, `ai-reasoning-view.tsx`,
  `markdown-content.tsx`, `ai-interaction-prompt.tsx`
- `tools/dashboard/src/components/ai-session-list.tsx` — narrowly, Task 09 only, to
  remove the dead `AiSessionStatus` `'completed'` branches (D9); general sidebar work
  stays `ux-improvements-version-1`'s `dedupe-recent-sessions`
- `tools/dashboard/src/components/ui/*` (new `Sheet`/`Dialog` primitive)
- `tools/dashboard/src/lib/nevo-assistant-runtime.ts`, `types.ts`
- `tools/ai/contracts.mjs`, `transcript-cache.mjs`, `turn-runtime.mjs`,
  `claude-adapter.mjs`, `antigravity-adapter.mjs`, `service.mjs`, `binding-service.mjs`
- `tools/dashboard/server/ai-routes.mjs`
- `tools/dashboard/package.json` (new dependency)
- `docs/development/react-component-guidelines.md` (new durable doc)
- Tests: `tools/tests/claude-adapter.test.mjs`, `tools/tests/antigravity-adapter.test.mjs`,
  `tools/tests/ai-turn-runtime.test.mjs`, `tools/tests/ai-contracts.test.mjs`,
  `tools/tests/agent-binding.test.mjs`, and
  `tools/dashboard/tests/{ai-chat-helpers,ai-contract-drift,ai-server}.test.mjs`

## Options and trade-offs

Three change-level forks were presented as gated owner decisions (both/all options,
trade-offs, and a recommendation each) and have since been decided — see
`owner-decisions.md` for the full analysis:

- **D5 — session→task binding aggregation. Decided: Option A.** Fan out
  `createSession` into one `bindSession` call per task; aggregate existing multi-row
  storage at the service/API boundary via `listBindings`. Option B (migrate the
  binding record itself to a persisted `taskIds[]`) was considered and rejected — the
  storage already supports the required cardinality, so migrating it would have fixed
  a service/API aggregation bug by redesigning persistence instead.
- **D6 — tool terminal-status contract. Decided: Option A.** `tool.completed` becomes
  a true terminal event carrying an explicit validated `status: 'completed' |
  'failed'`. Option B (`tool.completed` stays success-only; failure carried by a
  separate explicit terminal signal) was considered and rejected in favor of the
  smaller net surface and consistency with the existing `tool.updated` status
  precedent. Both options would have required the same adapter-level
  reordering/suppression fixes and the same restart/orphan-recovery fix — those are
  implemented regardless of which option was chosen.
- **D10 — cross-spec session binding. Decided: Option C.** Keep bindings spec-scoped;
  aggregate `taskIds[]` only within `(provider, providerSessionId, specId)`; pick
  "current spec" deterministically by most-recent `lastSeenAt`. Option A (one current
  spec association, enforced by replacing prior bindings) and Option B (a separate
  explicit "current association" pointer) were considered and rejected — both would
  change `bindSession`/`autoBindAgentSession`'s deterministic-flow behavior, a far
  larger surface than the read-path-only fix Option C achieves the same observable
  correctness with.

Turn/message correlation (D7) is a decided correction, not an open fork: prove the
correlation, allow the smallest structural change needed (preferring an explicit
`turnId` on the normalized projection) rather than assuming "no wire/model change" is
achievable unconditionally.

## Owner decisions

See `owner-decisions.md` — D1 (requirements source), D2 (Architectural
classification), D3 (Radix Dialog), D4 (defer FR-17 reassignment), D5 (session→task
binding aggregation — decided: Option A), D6 (tool terminal-status contract —
decided: Option A), D7 (turn↔message correlation is a verified prerequisite), D8
(pre-implementation overlap preflight with `ux-improvements-version-1`), D9 (Session
Activity vs. Turn/Work Outcome vocabulary; `AiSessionStatus` narrowed and dead
branches removed), D10 (cross-spec session binding — decided: Option C, spec-scoped
aggregation).

## Proposed architecture

```text
provider adapters (tools/ai/claude-adapter.mjs, antigravity-adapter.mjs)
  — D6 (Option A): stop emitting a premature/hardcoded terminal signal ahead of the
    real outcome
        ↓
AiTurnRuntime (tools/ai/turn-runtime.mjs) — emits AGENT_EVENT_TYPES
  — D6 (Option A): #emitToolCompleted must preserve and forward `status`
        ↓
contracts.mjs — AGENT_EVENT_TYPES validation
  — D6 (Option A): tool.completed's shape gains a validated `status: 'completed' |
    'failed'` field
        ↓
SessionTranscriptCacheService (tools/ai/transcript-cache.mjs) — persists messages/toolCalls
  — D6 (Option A): completeRunningToolCalls must stop forcing 'completed' on
        turn.failed/markTurnInterrupted(); D7: turnId (or equivalent) must survive
        persistence
        ↓  SSE + REST snapshot
useNevoAssistantRuntime / applyAgentEvent (nevo-assistant-runtime.ts)
        ↓
frontend Work/Conversation projection (new, Task 01) — pure function(s) over
  session data → { conversation, workByTurn, currentActivity, turnOutcome }
        ↓
Conversation / Work / Session Context React components (Tasks 02-09)
```

Session details (spec/tasks/provider/mode/delete) is a separate pipeline: read/display
work over `AgentSessionSnapshot` data, plus the D5/D10 spec-scoped aggregation fix at
the `AiSessionService`/`ai-routes.mjs` boundary — it does not sit in the
event-projection pipeline above, and it makes no change to `bindSession`/
`autoBindAgentSession`'s write-side behavior.

## Overlap preflight with `ux-improvements-version-1` (D8)

Decided *before* Tasks 02-09 begin implementation, not deferred entirely to Task 11:

- **Dependency/reuse — coordinate, don't duplicate:** `task-session-linking` (Task 06),
  `mode-description-tooltip` (Task 07), `shared-status-label-component` (Task 09).
- **Do not start independently while pt1 is in flight — pt1 replaces this surface:**
  `composer-alignment` (Task 07), `mode-switcher-touch-target` (Task 05/07), the
  header instance of `delete-session-touch-target` (Task 06).
- **Independent:** `dedupe-recent-sessions` and every other
  `ux-improvements-version-1` task outside the open chat view.

Task 11 verifies, after implementation, that reality still matches this preflight and
performs the actual `abandoned` status transitions (this preflight itself does not
write to `ux-improvements-version-1`'s manifest — see D8 and Task 11).

## Areas

None. Every frontend task in this change requires
`docs/development/react-component-guidelines.md` directly in its `context.required` and
cites the specific sections it relies on inline, in its own "Implementation constraints"
— the durable guide is this change's sole source of truth for React guidance (follow-up
review of PR #35 removed the spec-local `areas/react-component-guidelines.md` index,
which had become a second, redundant required-context file duplicating what the durable
guide and each task's own inline citations already establish).

## Change-wide acceptance criteria

- [ ] No task requires a new provider capability, headless interaction protocol, or
      deterministic-workflow behavior change.
- [ ] Task 06 implements D5's Option A (aggregate existing binding rows; no persisted
      schema migration) and Task 01 implements D6's Option A (`tool.completed` carries
      an explicit validated terminal `status`) as decided in `owner-decisions.md`.
- [ ] A tool call that never received a real successful terminal signal — whether the
      turn terminated abnormally (failure, cancellation, restart/orphan recovery) *or*
      reached a normal `turn.completed` while that tool was still lingering — is never
      presented as successfully completed anywhere in the UI — enforced in Tasks 01,
      03, 04, tested per D6's required scenario list (including the normal-completion
      lingering-tool case).
- [ ] A session created with multiple linked tasks displays all of them in Session
      details, not just one — enforced in Task 06, verified at the actual HTTP session
      route (`GET /api/agent-sessions/:provider/:providerSessionId`) the dashboard
      consumes, not only at the binding-service layer or a UI mock; list-session
      filtering by one task does not truncate a logical session's `taskIds[]`.
- [ ] The same `(provider, providerSessionId)` bound under two different specs never
      produces a merged `taskIds[]` — Session details and the list API always scope
      task aggregation to one spec (D10), verified by a regression test with that
      exact fixture.
- [ ] Turn/message correlation is verified (live and after reload) before Work
      grouping ships — enforced in Task 01.
- [ ] Session Activity and Turn/Work Outcome are never conflated in any task's UI or
      acceptance criteria — enforced in Task 09. `AiSessionStatus` only declares
      values `resolveSessionActivity()` actually produces (`idle`/`running`/
      `waitingForUser`) — verified by Task 09's contract test.
- [ ] `@radix-ui/react-dialog` is the only new dependency introduced by this change.
- [ ] `ux-improvements-version-1` tasks classified "do not start independently" in D8
      are actually replaced by equivalent or better behavior once this change ships,
      verified by Task 11.
- [ ] `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`,
      and `node --test tools/tests/{claude-adapter,antigravity-adapter,ai-turn-runtime,
      ai-contracts,agent-binding}.test.mjs` pass after every task that touches
      `tools/ai/*`.
- [ ] `node tools/specs.mjs validate` and `node tools/docs.mjs validate` pass.

## Verification strategy

Per-task `npm --prefix tools/dashboard test` / `run build` (see each task's
Verification section), plus `node --test tools/tests/*.test.mjs` for tasks touching
`tools/ai/*` (Tasks 01 and 06), plus Task 10's dedicated responsive/accessibility/
regression pass across the whole redesigned surface, plus `node tools/specs.mjs
validate` for spec structure and `node tools/docs.mjs validate`/`generate` for the new
durable doc. No new CI pipeline changes are introduced.

## Out of scope

Everything listed in the brief §3.3 (deterministic workflow/task-attach semantics,
new provider capabilities, `AskUserQuestion`/headless interaction, subagent execution,
provider todo/plan capability, provider session lifecycle redesign, new model/usage
provider integration, local file viewer/`file:line` navigation, final desktop workspace
redesign), plus, per owner decisions recorded here:

- FR-17's *reassignment action* (changing which spec a session is associated with) —
  deferred to Chat Capabilities (D4). Displaying the *current* association is in scope
  (Task 06).
- Consolidating the legacy `/api/ai/...` vs. current `/api/agent-sessions/...` API
  surfaces — noted as a constraint/observation, not addressed by this change unless a
  specific task requires touching one of the legacy-surface call sites it already
  relies on (session create/delete).
- Migrating the session→task binding record's on-disk shape (D5's Option B —
  considered and rejected; D5 is decided as Option A).
- Introducing a new event type, or any `AgentToolCall.status` value beyond `'running' |
  'completed' | 'failed'` (e.g. `'cancelled'`/`'interrupted'`) — D6's Option A adds a
  validated `status` field to the existing `tool.completed` event only; finer-grained
  outcome distinctions are carried as turn-outcome metadata (D9), not new tool-status
  values.

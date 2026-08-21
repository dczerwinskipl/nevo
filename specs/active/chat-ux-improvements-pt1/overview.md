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
(`owner-decisions.md` D1, D6).

## Current architecture

Grounded in two discovery passes (frontend and backend/events) against the current
repository state:

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
for live events (`tools/dashboard/server/ai-routes.mjs`). Every event carries `turnId`
(`contracts.mjs:317`), but there is no existing first-class "Work"/turn-grouping
aggregate — grouping today only exists implicitly through which `NormalizedMessage` a
tool call's events get folded into
(`tools/ai/transcript-cache.mjs`, `nevo-assistant-runtime.ts`'s `applyAgentEvent`,
lines 84-239). Session↔spec/task association is a JSON-file binding record
(`AgentSessionBindingService`, `tools/ai/binding-service.mjs:23-525`,
`.nevo-ai-local/sessions/<specId>.json`) that is additive/specializing (can add a
`taskId` to a spec-only binding) but has no reassignment endpoint — `PATCH
/api/agent-sessions/:provider/:providerSessionId` only changes `mode`
(`ai-routes.mjs:292-301`). Two parallel API surfaces exist: the current
`/api/agent-sessions/...` surface (`nevo-assistant-runtime.ts`) and a server-labeled
`/api/ai/...` "legacy" surface (`ai-routes.mjs:87-89`) still used for session
create/delete (`hooks/use-dashboard-data.ts`, wired into `ai-chat.tsx:29-31`).

## Problem

The current architecture cannot present a conversation-first view without either
(a) rendering every raw tool event as a first-class card, which is the exact problem
this change fixes, or (b) inventing per-turn Work grouping and human-readable labels
on the fly inside JSX, which the current component already does not do cleanly (no
existing precedent for grouping beyond message-boundary folding). It also has two
data-integrity gaps discovered during repository mapping that block correct display of
data this change's UI already needs:

1. `AiSessionService.createSession` (`tools/ai/service.mjs:22`) collapses a
   multi-element `taskIds` array down to a single `taskId` (or none) before persisting
   the binding — a session created with more than one linked task loses all but one at
   creation time. This blocks Session details (this change) from correctly showing the
   full associated-task list. See `owner-decisions.md` D5.
2. When a turn terminates (`turn.completed`/`turn.failed`) while a tool call is still
   `running`, both the frontend reducer (`nevo-assistant-runtime.ts:225-234`) and the
   backend transcript cache's `completeRunningToolCalls`
   (`tools/ai/transcript-cache.mjs:15`) force that tool call's status to `'completed'`
   regardless of how the turn ended — a tool call in a failed/interrupted turn can
   currently display as successfully completed. This directly blocks FR-4 (Work
   failure visibility). See `owner-decisions.md` D6.

## Constraints

- No deterministic-workflow behavior change: `tools/specs.mjs start` →
  `autoBindAgentSession` (`tools/specs.mjs:52-73,104`) and the `agent-session attach`
  CLI path (`tools/specs.mjs:1793-1810`) are out of scope; this change only changes how
  the *result* of that binding is displayed and (per D5) how faithfully it is
  persisted, never how/when a task auto-binds a session.
- No new provider capability, headless interaction protocol, or subagent execution
  support (brief §3.3).
- Session status vocabulary stays as-is: `idle | running | waitingForUser | completed |
  failed` (`tools/dashboard/src/lib/types.ts:346`) — there is no `stopped` value;
  cancellation is `turn.failed` with `AI_TURN_CANCELLED`
  (`tools/ai/turn-runtime.mjs:565,568`), resolving back to `idle`. Do not invent a
  `stopped` status the runtime cannot actually distinguish.
- New external dependency: `@radix-ui/react-dialog` only (`owner-decisions.md` D3) — no
  other general-purpose UI/component framework (see
  `areas/react-component-guidelines.md` §2.3, §30).
- All frontend tasks in this change are additionally governed by
  `areas/react-component-guidelines.md` (component sizing/composition, projection
  outside JSX, view-model update-boundary discipline, memoization, accessibility,
  Radix-wrapper conventions) — required reading for every task listed below.
- Reuse `ux-improvements-version-1`'s verified `design-tokens` task and its in-flight
  `shared-status-label-component`/`mode-description-tooltip` tasks rather than
  reinventing chat-local equivalents (see "Overlap analysis" below).

## Affected modules

- `tools/dashboard/src/components/ai-chat.tsx` (message list, header, composer — split
  across tasks)
- `tools/dashboard/src/components/ai-tool-view.tsx`, `ai-reasoning-view.tsx`,
  `markdown-content.tsx`, `ai-interaction-prompt.tsx`
- `tools/dashboard/src/components/ui/*` (new `Sheet`/`Dialog` primitive)
- `tools/dashboard/src/lib/nevo-assistant-runtime.ts`, `types.ts`
- `tools/ai/contracts.mjs`, `transcript-cache.mjs`, `turn-runtime.mjs`, `service.mjs`,
  `binding-service.mjs`
- `tools/dashboard/server/ai-routes.mjs`
- `tools/dashboard/package.json` (new dependency)
- Tests under `tools/dashboard/tests/*.test.mjs` (in particular
  `ai-chat-helpers.test.mjs`, `ai-contract-drift.test.mjs`, `ai-server.test.mjs`)

## Options and trade-offs

Per-task option analysis lives in the individual task files where a gate applies
(Task 06 for the new dependency). At the change level, the only architectural fork
was where per-turn Work grouping is computed: purely frontend (over the `turnId`
already present on every event and message) vs. a new backend-computed/persisted
aggregate. Recorded as an implementation-detail finding, not an owner gate: existing
messages already fold tool calls under the owning assistant message
(`nevo-assistant-runtime.ts`'s `applyAgentEvent`), so frontend-only projection over
already-delivered data is sufficient — no new backend aggregate or wire-format change
is required for grouping itself (Task 01 confirms/documents the exact
message↔turn correlation as part of its own acceptance criteria).

## Owner decisions

See `owner-decisions.md` — D1 (requirements source), D2 (Architectural classification),
D3 (Radix Dialog), D4 (defer FR-17 reassignment), D5 (fix `taskIds` collapse in pt1),
D6 (abrupt mid-tool-failure is explicit acceptance criteria, not a loose note).

## Proposed architecture

```text
provider adapters (tools/ai/*-adapter.mjs)
        ↓
AiTurnRuntime (tools/ai/turn-runtime.mjs) — emits AGENT_EVENT_TYPES
        ↓
SessionTranscriptCacheService (tools/ai/transcript-cache.mjs) — persists messages/toolCalls
        ↓  SSE + REST snapshot
useNevoAssistantRuntime / applyAgentEvent (nevo-assistant-runtime.ts)
        ↓
frontend Work/Conversation projection (new, Task 01) — pure function(s) over
  NormalizedMessage[] → { conversation, workByTurn, currentActivity }
        ↓
Conversation / Work / Session Context React components (Tasks 02-09)
```

Session details (spec/tasks/provider/mode/delete) is additive read/display work over
already-fetched `AgentSessionSnapshot` data plus the `taskIds`-collapse fix (D5); it
does not sit in the same event-projection pipeline as Work.

## Areas

- `areas/react-component-guidelines.md` — cross-cutting React engineering conventions,
  required reading for every task below (not an independently implementable concern;
  see its own "Responsibility" section).

## Change-wide acceptance criteria

- [ ] No task requires a new provider capability, headless interaction protocol, or
      deterministic-workflow behavior change.
- [ ] A tool call that never received an explicit successful completion, in a turn that
      terminated abnormally, is never presented as successfully completed anywhere in
      the UI (D6) — enforced in Tasks 01, 03, 04.
- [ ] A session created with multiple linked tasks displays all of them in Session
      details, not just one (D5) — enforced in Task 06.
- [ ] `@radix-ui/react-dialog` is the only new dependency introduced by this change.
- [ ] `ux-improvements-version-1` tasks classified "superseded" in Task 11's overlap
      analysis are actually replaced by equivalent or better behavior, not silently
      dropped.
- [ ] `npm --prefix tools/dashboard test` and `npm --prefix tools/dashboard run build`
      pass after every task.
- [ ] `node tools/specs.mjs validate` passes.

## Verification strategy

Per-task `npm --prefix tools/dashboard test` / `run build` (see each task's
Verification section), plus Task 10's dedicated responsive/accessibility/regression
pass across the whole redesigned surface, plus `node tools/specs.mjs validate` for spec
structure. No new CI pipeline changes are introduced.

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

---
id: spec.multi-task-agent-execution
type: change
title: "Multi-task agent execution"
status: draft
change: multi-task-agent-execution
---

# Multi-task agent execution

Introduces a general, explicit **execution scope** so one agent execution/session can own
several tasks at once, with **batched review** as the first concrete use case: three completed
tasks reviewed together in one session, sharing context once, while each task still receives its
own independent verdict, feedback, and workflow transition.

## Context

Deterministic execution is single-task scoped end to end today. When several tasks in the same
change are ready for review, the only available flow is one review session per task, repeating
the same shared architectural context/files each time and making cross-task consistency checks
harder than they need to be. See `owner-decisions.md` for the full option analysis and the
decisions recorded below (D1–D13).

## Current architecture

Grounded directly in the current code (file:line references from discovery, re-verified against
each area's own "Current state" section):

- `AgentSession` (`tools/dashboard/server/ai/sessions/binding-service.mjs`) already carries
  `taskIds: string[]` and a single-scalar `activeTaskId`, but every downstream consumer treats
  exactly one task as "in scope" — `taskIds` today is used only for lookup, never for
  simultaneous execution/review context.
- `parentSessionId` is a single scalar everywhere. `reconciliation.mjs`'s queue-advancement path
  explicitly sets it to `null` when moving to a different queued task ("Ordinary queued task
  advancement does not fabricate lineage from prior task") — cross-task lineage is deliberately
  out of scope today, not an oversight.
- The workspace-writer claim (`tools/specs/workflow/workspace-writer.mjs`) has `taskId` as an
  optional, singular scalar. No multi-task claim shape exists.
- **D33** (`specs/active/deterministic-status-architecture/owner-decisions.md`): for one
  specification, at most one agent-owned execution may be running at a time. Enforced
  redundantly at the queue evaluator (`nextRunnable` is one item, never a set), `admission.mjs`'s
  `activeExecutions` map (keyed by spec, singular `taskId`), and `reconciliation.mjs`. This
  invariant is preserved unchanged by this change — a batch execution is still **one** execution
  holding **one** claim.
- `/nevo-ai:implementation-review` already implements "per-task verdict + cross-task integration
  pass + aggregate report," but at the *prompt-orchestration* level: each task is reviewed by a
  fresh, isolated subagent running single-task `task-review`; only the cross-task pass and
  aggregate report run in the orchestrating session. It never gives one session simultaneous full
  context over multiple tasks.
- Legacy `batch-start`/`batch-review` is "loop the existing single-task lifecycle N times, then
  one closing aggregate review" — also not a single multi-task AI session.
- `tools/specs/workflow/remediation-review/` (dependency-invalidation remediation) is the closest
  *runtime* precedent for "per-task pass + cross-task pass + one aggregate verdict table," but is
  purpose-built around release-epoch/invalidated-dependency semantics, not general multi-task
  review.
- The only context-packet builder, `buildContextPacket` (`tools/specs/context.mjs`), is
  single-task only — no dedup/union logic exists across tasks.
- `docs/development/orchestration.md` describes an unrelated, self-admittedly-unfinished
  experimental C# saga subsystem (`NEvo.Orchestrating`) — not connected to any of the above;
  flagged so the term "orchestration" isn't conflated across the two.

**Conclusion**: nothing in the repository today gives one AI session simultaneous full context
over multiple tasks. This is new runtime ground, not an extension of the existing queue/batch
concepts (which remain sequential single-task execution, unchanged by this change) or a rename of
`implementation-review` (which stays prompt-level subagent orchestration, unchanged by this
change).

## Problem

A reviewer who could see three related completed tasks together would benefit from shared
architectural context, shared source files, and a real cross-task integration check — but the
current architecture has no way to give one agent execution authority over more than one task at
once without silently faking it (`activeTaskId = first task` while secretly touching several).

## Constraints

- **C1.** D33 (single active agent execution per specification) is unchanged: a batch execution
  is one execution, one claim, one session — never concurrency.
- **C2.** `tools/specs/workflow/queue/**` never imports `tools/dashboard/**` (existing boundary,
  unchanged).
- **C3.** The workspace-writer claim remains the sole durable physical-workspace ownership
  source; no area introduces a second ownership authority.
- **C4.** No new external dependency; every new module is additive within the existing
  `tools/specs/workflow/**` / `tools/dashboard/server/ai/**` layering.
- **C5.** The admission/reconciliation/execution-policy neighborhood received four corrective
  commits in the ~30 hours before this spec was written (`28bd6405`, `e5a02854`, `ff712dec`,
  `35fb00e8`) — still-settling ground, not stable. Tasks touching it should re-verify current
  file contents before editing rather than assuming this overview's file:line citations are
  still exact by the time implementation starts.

## Affected modules

`tools/dashboard/server/ai/sessions/{binding-service,service,execution-policy-service}.mjs`,
`tools/dashboard/server/ai/orchestration/{admission,reconciliation}.mjs`,
`tools/specs/workflow/{workspace-writer,queue/**,context}.mjs` (new: `execution-scope.mjs`,
`batch-finish/**`, `batch-context.mjs`), `.claude/skills/multi-task-review/` (new),
`tools/dashboard/ui/screens/specification-detail/**`, `tools/dashboard/ui/features/agent-sessions/**`,
`docs/development/{agent-workflow-protocol.md,workflow-engine.md,ai-sessions.md}`.

## Options and trade-offs

Full option analysis for D2 (execution scope representation) and D3 (batch-finish atomicity) is
recorded in `owner-decisions.md` — three options each, with rejection reasons and the
consequences-at-equal-cost statement. D4 (read-only vs. writable v1 review) and D1
(workflow mode) are recorded there as simple gated decisions. Not repeated here; `owner-decisions.md`
is the source of truth for *why*, this document is the source of truth for *what*.

## Owner decisions

See `owner-decisions.md`, D1–D13. All recorded 2026-09-27.

## Proposed architecture

An explicit, persisted `ExecutionScope`:

```ts
type ExecutionScope =
  | { kind: "task"; taskId: string }
  | { kind: "task-batch"; taskIds: string[] };
```

For `kind: "task-batch"`, `ExecutionScope` is the **sole canonical source of truth** for
execution ownership and membership (D2) — existing singular fields (`activeTaskId`,
`claim.taskId`) are never promoted to authoritative for a batch, and no `primaryTaskId` is
introduced unless a real UI need proves it necessary (none is proven by this change).

Six cohesive, independently implementable areas (order reflects dependency, not build sequence
within an area):

1. **`execution-scope-model`** — the `ExecutionScope` type itself, and its threading through
   `AgentSession`, `SessionTaskBinding`, the workspace-writer claim, and `admitAgentExecution`,
   while preserving D33 (still one execution, one claim) and C3 (claim stays the sole workspace
   ownership source).
2. **`batch-queue-reservation`** — compatibility-checked grouping of ready review items, durable
   reservation of the exact group so the sequential queue never dispatches a reserved item
   elsewhere, crash recovery, without changing ordinary single-item scheduling.
3. **`batch-finish-operation`** — the atomic/durable "workflow batch finish" operation: validate
   every task's result before any mutation is externally visible, persist the complete batch
   result durably, apply each task's own transition idempotently, then — only once every task's
   mutation is durably confirmed — recompute and dispatch continuations together.
4. **`batch-context-and-report`** — the deduplicated `BatchContext` (shared docs/files delivered
   once with `usedBy` attribution, per-task specifics preserved), the one canonical shared batch
   report, each task's durable reference into it, and the additive `predecessorSessions` lineage
   field.
5. **`multi-task-review-skill`** — the `multi-task-review` skill defining reviewer behavior
   (read shared context once, review each task independently, cross-task consistency check,
   produce structured per-task outcomes + cross-task findings, submit one batch-finish call),
   read-only over source paths (D4).
6. **`dashboard-batch-review-ux`** — the minimal interaction semantics: task picker offering
   "review individually" vs. "review together" for a compatible set, starting one batch session
   with the normal explicit provider/model/mode picker, and surfacing per-task verdicts plus the
   shared report link.

A compatible review batch requires every member task to share: the same specification/change, all
currently eligible, the same target workflow step, executor `agent`, the same effective execution
role (via the existing role-based execution policy), and no incompatible suspension/blocking
state. The common v1 case is every member task at `review`/`reviewer`.

## Compatibility and migration

Additive throughout: existing single-task sessions/claims/queue items become
`{kind: "task", taskId}` with zero behavior change; nothing currently persisted needs a data
migration (absent scope field defaults to `kind: "task"` wherever read). `AgentSession.taskIds`/
`activeTaskId` keep their existing meaning for single-task sessions.

## Areas

- `areas/execution-scope-model.md`
- `areas/batch-queue-reservation.md`
- `areas/batch-finish-operation.md`
- `areas/batch-context-and-report.md`
- `areas/multi-task-review-skill.md`
- `areas/dashboard-batch-review-ux.md`

## Change-wide acceptance criteria

- D33 remains enforced: at every point, at most one agent-owned execution is active per
  specification, whether that execution's scope is `task` or `task-batch`.
- A batch review produces N independent per-task results (verdict, feedback, workflow
  transition, history entry, lineage reference) — never one aggregate verdict standing in for the
  group.
- No task's own workflow transition becomes externally visible (queue-observable, continuation
  eligible) until every task in the same batch-finish call has had its result durably validated
  and accepted.
- An invalid result for any one task in a batch-finish payload rejects the whole call before any
  task's state changes.
- A failed task inside a batch continues through the existing single-task fresh refiner role,
  unchanged.
- The batch reviewer session makes no write to any source path during v1 — only its own report
  file and the batch-finish call.
- `tools/specs/workflow/queue/**` still contains zero imports of `tools/dashboard/**`.
- `node tools/specs.mjs validate` passes with the new manifest/task shapes.

## Verification strategy

`node --test tools/tests/*.test.mjs` (existing suite must stay green — this change is additive),
plus new/extended tests per task (see each task's own `## Verification`), `node tools/specs.mjs
validate`, `node tools/docs.mjs validate` where documentation is touched.

## ADR impact

No existing ADR is superseded. A new ADR recording the `ExecutionScope` model and the
batch-finish atomicity design is worth writing once the areas below are implemented — deferred to
implementation time rather than authored speculatively now (owner may decide otherwise during
`spec-review`).

## Out of scope

- Automatic (non-explicit) batch grouping (D5).
- Any batch-size limit enforced by the runtime (D6) — UI guidance only.
- Concurrent execution of any kind — D33 is unchanged.
- A writable v1 batch reviewer (D4) — deferred, not designed here.
- Any execution role other than reviewer getting an actual wired-up batch execution path (D13) —
  the abstraction is generic, the v1 path is reviewer-only.
- A general content-hash/context-refresh subsystem — `batch-context-and-report` reuses the
  existing single-task context-packet mechanism; it does not reopen that broader, previously
  deferred architecture.
- Converging `remediation-review`/`implementation-review` into one primitive with this feature's
  `ExecutionScope` (D2, Option 3) — remains a reachable future follow-up, not built now.
- A dedicated `/nevo-ai:*` command wrapper around the batch reviewer flow — the skill and CLI
  surface are sufficient for v1; a command wrapper (mirroring `/nevo-ai:implementation-review`)
  is a natural follow-up, not required for this change's own correctness.

---
id: spec.session-continuity-choice
type: change
title: Session continuity choice
status: draft
change: session-continuity-choice
---

# Session continuity choice

## Context

On 2026-10-11, after the owner clicked "Request changes" on a task, the dashboard started
the implementation in a brand-new chat although the previous implementation session was
recorded and could simply have been continued. The owner also wants the same question when
reviewing several tasks together: continue in each task's original chat, or open one new
batch chat. Two further observations from discovery: batch review already exists but is
hidden unless strict conditions hold, and continuing in a session is a deliberate engine
capability that the UI cannot reach.

## Current architecture

- The workflow definition fixes the session behavior per transition.
  `.nevo-ai/workflows/standard-v1.yaml` declares `execution: { session: fresh, role:
  refiner }` for `human-verification → implementation` (request changes) and for
  `review → implementation`, and `fresh/reviewer` for `implementation → review`.
- The engine already supports `execution.session: reuse` (many tests, for example
  `deterministic-status-corrective.test.mjs` Test 34 and
  `deterministic-execution-session-policy-unification.test.mjs`).
- Session resolution is server-side. `deterministic-execution-plan.mjs` derives
  `parentSessionId` by walking the task's history backwards, skipping human steps, to the
  latest step carrying a `sessionId` (or a single matching binding). On request-changes
  that is the **review** session, not the implementation session.
- The server rejects a client `sessionPolicy` that conflicts with the definition's
  declared policy, and a `sessionId` that differs from the derived one, so the UI cannot
  choose.
- `Review together` (`specification-overview.tsx`) starts one new `task-batch` session. It
  is shown only when at least two tasks are selected, every one targets the `review` step
  (or reviewer role), and every one has `start-step` available. When the conditions fail
  the control is simply absent, with no explanation. There is no "continue in original
  sessions" variant; `Review individually` starts fresh sessions.
- ADR-0009 permits one active execution per specification and defines `task-batch` scope.
- Independent review is a deliberate property: the definition gives review a fresh session
  and a reviewer role.

## Problem

The owner cannot continue an existing session after request-changes or for a review, the
only reuse the engine would derive is the wrong session, and the batch-review option is
both undiscoverable and lacks a session choice.

## Constraints

- ADR-0009: one active execution per specification; claims stay conditional and
  fail-closed; no new concurrency.
- The server stays the authority: it derives the candidate session and validates any client
  choice against the definition. The client never supplies an arbitrary session id.
- A reused session keeps its provider and mode. If the policy-resolved provider for the
  target role differs from the session's provider, reuse is unavailable with an explicit
  reason; it must never silently switch providers.
- `execution.session: reuse` already requires an exact, derivable predecessor; this change
  must not weaken that.
- Contained to `tools/`, `.nevo-ai/workflows/`, and `docs/`.

## Affected modules

`tools/specs/workflow/definitions/` (schema, normalization), `.nevo-ai/workflows/standard-v1.yaml`,
`tools/specs/workflow/resolve-incoming-execution.mjs`,
`tools/dashboard/server/ai/orchestration/deterministic-execution-plan.mjs`,
`tools/dashboard/server/ai/sessions/turns/routes.mjs`,
`tools/specs/workflow/queue/` (batch compatibility, sequencing),
`tools/dashboard/server/specs/actions.mjs`,
`tools/dashboard/ui/` (start dialog, specification detail and overview),
`docs/development/workflow-engine.md`, ADR.

## Options and trade-offs

See D1. Selected: option 2. Rejected: option 1 (no choice, wrong session, global effect);
option 3 (free-standing work threads; larger than the problem).

## Owner decisions

D1 (option 2), D2 (extend `standard-v1`), D3 (batch continuation is sequential), D4
(defaults) — `owner-decisions.md`.

## Proposed architecture

1. **Definition.** A transition's `execution` gains optional `allow` (subset of
   `fresh`, `reuse`; defaults to the declared `session` only) and `reuseFrom` (a step id
   whose most recent agent session is the reuse candidate; defaults to today's
   derivation). `standard-v1` annotates: request changes → default `reuse`, `reuseFrom:
   implementation`, `allow: [reuse, fresh]`; implementation → review → default `fresh`,
   `allow: [fresh, reuse]`, `reuseFrom: implementation`.
2. **Server resolution.** The execution plan derives the candidate from `reuseFrom`,
   accepts a client `sessionPolicy` only if it is in `allow`, validates `sessionId`
   against the derived candidate, and checks provider compatibility. Errors carry codes.
3. **Projection.** The task actions DTO exposes a `sessionChoice` object: default policy,
   allowed policies, the candidate session (id, step, attempt, provider, human label), and
   an `unavailableReason` when reuse cannot be offered.
4. **Single-step UI.** The start dialog asks "continue in session X / start a new session"
   when more than one policy is allowed, pre-selects the definition's default, and shows a
   warning when choosing to continue for a review step.
5. **Batch.** Selecting two or more tasks for review offers "one new batch session" (the
   existing `task-batch` behavior) or "continue in each task's own session". The latter is
   sequential: the first turn starts immediately, the rest are chained and each starts when
   the previous settles. The batch-review control is always shown when two or more tasks
   are selected, and when unavailable it says why.
6. **Docs.** Workflow-engine documentation and an ADR describe the new definition fields,
   the validation rules, and the sequential batch semantics.

## Compatibility and migration

Backward compatible (D2). Definitions without the new fields behave as before. Specs on
`standard-v1` get the choice for the annotated transitions. The default for request-changes
changes from a fresh session to continuing the implementation session (D4); this is a
visible behavior change and is called out in the docs.

## Areas

Not split — the definition, server, and UI layers are tightly coupled by one contract.

## Change-wide acceptance criteria

- After "Request changes" the dashboard offers to continue the task's last implementation
  session, pre-selected, and choosing it appends a turn to that same session instead of
  creating a new one.
- For a review step the dashboard offers a new session (pre-selected) and continuing in
  the implementation session with a warning.
- For two or more tasks the owner can choose a new batch session or continue each in its
  own session; the latter runs sequentially and never concurrently.
- The server rejects a `sessionPolicy` not allowed by the definition and a `sessionId`
  that is not the server-derived candidate.
- A reuse that would change provider is not offered and the reason is shown.
- Definitions without the new fields behave exactly as before.

## Verification strategy

`node --test tools/tests/` and `node --test tools/dashboard/tests/` for the affected
suites, `node tools/specs.mjs validate`, `node tools/docs.mjs validate`, and a manual run
in the dashboard for request-changes and for a three-task review.

## Open questions

- **Non-blocking:** should `review → implementation` (review failed) also default to
  continuing the implementation session? Currently it only allows it. Decide before task
  01 is approved, or leave as allowed-not-default.
- **Non-blocking:** wording and labels of the session candidate in the dialog (for
  example "Implementation, attempt 1, Claude Sonnet").
- **Implementation detail:** how the chained turns of a sequential batch are persisted
  (reuse the existing durable pending-handover mechanism where it fits).

## ADR impact

Likely a new ADR (workflow definition session choice and validation) or an ADR-0009
addendum for the sequential-batch semantics; the choice is made in task 07 and flagged to
the owner there, not decided here.

## Out of scope

- Session as a free-standing work thread (option 3).
- Parallel turns across tasks.
- Changing provider, mode, or role resolution policy.
- Error visibility and stuck pending state for blocked actions
  (`workspace-claim-self-recovery`).

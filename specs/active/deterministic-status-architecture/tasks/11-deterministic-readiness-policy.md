---
id: deterministic-status-architecture.deterministic-readiness-policy
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/execution-readiness-and-session-bootstrap.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/readiness-policy.mjs
  - tools/specs/workflow/cli.mjs
  - tools/dashboard/server/ai/sessions/**
  - tools/tests/deterministic-readiness-policy.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/specs/lifecycle-primitives.mjs
  - tools/dashboard/ui/**
  - src/**
depends_on: [ workflow-task-publish-operation, deterministic-task-projection, step-executor-guard ]
---

# Task: Deterministic readiness policy

## Goal

Build the one shared readiness policy — built on the canonical task projection and reusing
the executor guard — and wire it into both `workflow step start` and the "Start
implementation"/"Start review" session-creation entry points, distinguishing a genuinely
new attempt (still requires a clean worktree) from resuming an already-active attempt
(does not).

## Dependencies

`workflow-task-publish-operation`, `deterministic-task-projection` — the policy's
preconditions read both. `step-executor-guard` — reused, not reimplemented, for the
executor-mismatch precondition.

## Implementation constraints

- New module (e.g. `tools/specs/workflow/readiness-policy.mjs`) exposing one function
  (task + change + caller kind → ready/not-ready + reason), consuming
  `deterministic-task-projection`'s output and calling `step-executor-guard`'s function for
  the executor check — fails closed when: task is still `draft`/unpublished; a dependency
  is unsatisfied; the workflow is terminal; the executor guard rejects the caller kind; or
  a clean-worktree/operation guard fails for a *new* attempt specifically.
- Distinguish new-attempt vs. resume: inspect whether the current, already-in-progress
  attempt's own worktree state is what's "dirty" (allowed) versus an unrelated/stale dirty
  state or a request to allocate a next attempt on top of it (still blocked). Reuse whatever
  existing attempt/worktree-identity signal `start`-style operations already have — do not
  invent a new persisted field for this distinction.
- Call this function from `handleWorkflowStepStart` (`tools/specs/workflow/cli.mjs`) before
  proceeding — do not duplicate its logic inline.
- Investigate `tools/dashboard/server/ai/sessions/{routes,service,binding-service}.mjs`
  first to establish whether a server-side readiness re-check already exists for
  deterministic execution-bound sessions; wire it to call this same policy function at the
  specific "Start implementation"/"Start review" entry points
  (`specification-detail-content.tsx`'s `handleWorkflowAction`,
  `agent-session-page.tsx`'s `handleStartReviewTask`, server-side) — not at
  `CreateAgentSessionDialog`'s generic, contextual-`taskIds` path.
- Only requests carrying an authoritative execution task id are subject to this check — a
  session with only contextual `taskIds` (including a draft task, no authoritative `taskId`)
  must never be checked against this policy.

## Acceptance criteria

- `workflow step start <change> <task>` against a draft/unpublished task fails closed with
  a clear error (brief regression test #6, #10).
  `automated: node --test tools/tests/deterministic-readiness-policy.test.mjs`
- `workflow step start <change> <task>` against a task with an unsatisfied dependency fails
  closed, naming the blocking dependency. `automated: node --test tools/tests/deterministic-readiness-policy.test.mjs`
- `workflow step start <change> <task>` against a human-owned current step fails closed via
  the reused executor guard, not a second implementation.
  `automated: node --test tools/tests/deterministic-readiness-policy.test.mjs`
- A "Start implementation"/"Start review" request naming an authoritative execution task id
  that is not ready is refused server-side even when sent directly, bypassing any UI-hidden
  button (brief regression test #9). `automated: node --test tools/tests/deterministic-readiness-policy.test.mjs`
- A request carrying only contextual `taskIds` (no authoritative `taskId`) succeeds
  regardless of any task's readiness — the policy is never invoked for it (brief regression
  test #7, #8). `automated: node --test tools/tests/deterministic-readiness-policy.test.mjs`
- A genuinely new attempt against a dirty baseline worktree fails closed; resuming an
  already-active attempt whose worktree contains only that attempt's own changes succeeds
  (corrective-pass item 11). `automated: node --test tools/tests/deterministic-readiness-policy.test.mjs`
- `workflow step start`/session creation against a ready, published, dependency-satisfied,
  correctly-executor-matched task is unaffected — no new failure introduced for the
  already-working path. `automated: node --test tools/tests/workflow-cli.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-readiness-policy.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any change to legacy session-creation behavior. Client-side UI action projection (owned by
the UI-split tasks, which consume this same policy's results via the dashboard action DTO).

---
id: deterministic-status-architecture.deterministic-readiness-policy
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/execution-readiness-and-session-bootstrap.md
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
  - tools/dashboard/ui/**
  - src/**
depends_on: [ workflow-task-publish-operation, deterministic-task-projection ]
---

# Task: Deterministic readiness policy

## Goal

Build the one shared readiness policy — built on the canonical task projection — and wire
it into both `workflow step start` and the session-creation server route, so a session or a
direct CLI call cannot bypass what the UI merely hides.

## Dependencies

`workflow-task-publish-operation`, `deterministic-task-projection` — the policy's
preconditions read both.

## Implementation constraints

- New module (e.g. `tools/specs/workflow/readiness-policy.mjs`) exposing one function
  (task + change → ready/not-ready + reason), consuming
  `deterministic-task-projection`'s output — fails closed when: task is still
  `draft`/unpublished; a dependency is unsatisfied; the workflow is terminal; execution
  state is otherwise invalid; or an existing clean-worktree/operation guard fails.
- Call this function from `handleWorkflowStepStart` (`tools/specs/workflow/cli.mjs`) before
  proceeding — do not duplicate its logic inline.
- Investigate `tools/dashboard/server/ai/sessions/{routes,service,binding-service}.mjs`
  first to establish whether a server-side readiness re-check already exists for
  deterministic execution-bound sessions; if it does, wire it to call this same policy
  function instead of any existing ad hoc check; if it does not, add the call at the point
  the route binds an authoritative execution task id to a new/existing session.
- Only sessions with an authoritative execution task id are subject to this check — a
  session with `taskIds: []` (generic chat) or a session discussing a draft task without
  requesting execution must not be checked against this policy at all.

## Acceptance criteria

- `workflow step start <change> <task>` against a draft/unpublished task fails closed with
  a clear error (brief regression test #6, #10).
  `automated: node --test tools/tests/deterministic-readiness-policy.test.mjs`
- `workflow step start <change> <task>` against a task with an unsatisfied dependency fails
  closed, naming the blocking dependency. `automated: node --test tools/tests/deterministic-readiness-policy.test.mjs`
- A session-creation request naming an authoritative execution task id that is not ready is
  refused server-side even when sent directly, bypassing any UI-hidden button (brief
  regression test #9). `automated: node --test tools/tests/deterministic-readiness-policy.test.mjs`
- A session created with `taskIds: []` succeeds regardless of any task's readiness — the
  policy is never invoked for it (brief regression test #7, #8).
  `automated: node --test tools/tests/deterministic-readiness-policy.test.mjs`
- `workflow step start`/session creation against a ready, published, dependency-satisfied
  task is unaffected — no new failure introduced for the already-working path.
  `automated: node --test tools/tests/workflow-cli.test.mjs`

## Verification

```bash
node --test tools/tests/deterministic-readiness-policy.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any change to legacy session-creation behavior. Client-side UI action projection (owned by
the UI-split tasks, which consume this same policy's results).

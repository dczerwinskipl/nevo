---
id: deterministic-status-architecture.automatic-workflow-continuation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/workflow-continuation-and-session-handover.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/server/ai/orchestration/**
  - tools/dashboard/server/ai/routes.mjs
  - tools/dashboard/server/ai/sessions/service.mjs
  - tools/dashboard/server/specs/human-step-transport.mjs
  - tools/dashboard/server/specs/actions.mjs
  - tools/specs/workflow/human-step/operations.mjs
  - tools/tests/workflow-continuation.test.mjs
forbidden_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/queue/**
  - tools/specs/workflow/dependency-consumption.mjs
  - tools/specs/workflow/git-finalize-lock.mjs
  - tools/dashboard/server/ai/sessions/turns/runtime.mjs
  - src/**
depends_on: [ workflow-continuation-schema, execution-policy-and-mode-selection, deterministic-sequential-queue, dependency-release-and-invalidation ]
semantic_references:
  decisions: [D25, D26, D27, D33, D41, D42, D45, D47, D48, D49]
---

# Task: Automatic workflow continuation (agent admission + reconciliation + human dispatch)

## Goal

Build the server-side application/orchestration layer under
`tools/dashboard/server/ai/orchestration/**`: **`admitAgentExecution(specId, candidate)`
(D41/D49)** — the one spec-level, race-safe, atomic-through-to-durable-visibility admission
gate every **agent-owned** execution path funnels through, with rollback on failed session
creation — and **`reconcileWorkflowPosition(change, task)` (D42)** — the shared continuation-
reconciliation operation, triggered from three real, verified server-side points. Also build
the **human dispatch path** (D47/D49): a mutation-free interaction preview plus a new,
combined `activateAndSubmitHumanStep` operation for the user's own Approve/Request-changes
submission — a distinct branch from agent admission, never described as a form of it. This
task does **not** record dependency-consumption (moved to workflow core at step activation,
D48) and does **not** auto-activate a human step on arrival (D47).

## Implementation constraints

- **`admitAgentExecution`, atomic through to durable visibility, with rollback (D41/D49).**
  New file, `tools/dashboard/server/ai/orchestration/admission.mjs`. Reuses the
  `AgentTurnRuntime.#acquireStartLock` promise-chain-mutex pattern (`turns/runtime.mjs`,
  forbidden path — read for reference, reimplement small, do not modify), keyed by `specId`:
  acquire lock → re-read active-execution state → if occupied, reject/defer (candidate stays
  eligible, unchanged) → if free, mark occupied → **synchronously drive session/turn creation
  through to the point its canonical identity is durably observable** (e.g. the binding
  record is persisted) → release lock. **If session/turn creation fails after the claim is
  marked but before it becomes durably visible, roll back the claim** (clear "occupied")
  before releasing the lock/returning — the candidate remains eligible/retryable; the spec is
  never left falsely, permanently occupied. Only ever gates on an **agent** execution — a
  pending human interaction never blocks it (D45) and is never routed through it (D49).
- **`reconcileWorkflowPosition` (D42).** Given a task, resolves its authoritative
  `workflow_progress` position and matched transition. If the destination is **agent-owned**
  and `continuation: auto`: enqueue into the sequential queue (task 28), then call
  `admitAgentExecution`. If the destination is **human-owned** and `continuation: auto`: do
  **not** call `startHumanStep` — instead ensure the interaction preview (below) is available;
  no admission, no mutation. On `owner-action` (or absent), no-op either way.
- **Hooks 1–3, unchanged in mechanism from the prior pass:** `AgentSessionService`'s own
  per-turn subscription (Hook 1); `human-step-transport.mjs`'s post-`submitHumanStepResult`
  call (Hook 2 — now calling the new combined operation, see below); boot/first-request
  reconciliation (Hook 3).
- **Human interaction preview, no mutation (D47).** Extend `tools/dashboard/server/specs/
  actions.mjs` (task 14's existing, already-verified file): for a `waiting-for-step-start`
  position whose destination step is human-owned, compute the same
  `{result?, label, feedbackRequired}[]` shape the *active*-interaction descriptor already
  produces, but read directly from the workflow definition's declared transitions for that
  step — no `ensureStepActivated` call, no `workflow_progress` read/write beyond what's
  already needed to know which step is next (already available, D15). `HumanStepSurface`
  renders this identically to the active case (no component change needed).
- **`activateAndSubmitHumanStep` (new, D47).** New exported function in
  `tools/specs/workflow/human-step/operations.mjs` (core engine — not dashboard-only, since
  the CLI could reasonably expose the same combined behavior): calls `startHumanStep`
  immediately followed by `submitHumanStepResult({result, feedback, artifacts})` within one
  call, both wrapped by `withGitFinalizeLock` (imported from
  `tools/specs/workflow/git-finalize-lock.mjs`, task 27 — import only, do not edit that
  file) around the combined mutate-then-commit sequence. `human-step-transport.mjs`'s handler
  calls this new function instead of `startHumanStep`+`submitHumanStepResult` separately.
- **Session policy application (D26), human-step auto-activation removed (D27/D45/D47
  corrected).** On an admitted agent-owned destination, create/reuse a session per
  `execution: {session, role}` and the resolved execution policy (task 26). A human-owned
  destination is never proactively activated by this task — only the preview is exposed;
  activation happens only inside the user's own `activateAndSubmitHumanStep` call.
- No `switch`/`if`/lookup-object keyed on a literal step id anywhere in this task's code.

## Acceptance criteria

- Two simultaneous `admitAgentExecution` calls for the same spec never both return "admitted."
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a session/turn-creation failure occurring after the claim is marked but before
  durable visibility results in the claim being rolled back — a subsequent admission request
  for the same spec succeeds.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A pending human interaction on one task never blocks `admitAgentExecution` from admitting a
  different, independently-eligible agent-owned task in the same spec.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Reaching a human-owned destination via reconciliation exposes the interaction preview with
  **zero** `workflow_progress` mutation — proven by inspecting `change.yaml`'s content is
  byte-for-byte unchanged before and after the preview becomes visible.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- `activateAndSubmitHumanStep` performs activation, submission, and commit as one call;
  a test asserting no other operation can observe an uncommitted activation write (using the
  git-finalize lock's own test double/instrumentation from task 27) passes.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A human-owned destination reached via reconciliation never calls `admitAgentExecution` and
  never calls `startHumanStep` on its own (only `activateAndSubmitHumanStep`, only on user
  submit, calls it).
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a turn reaching terminal via `AgentSessionService`'s own per-turn subscription
  for `implementation → review` results in `review` being enqueued and admitted.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a server restart between a reconciliation-triggering event and the queue
  recording it results in the destination still being enqueued once the boot/first-request
  hook runs.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- This task's own diff writes no dependency-consumption record anywhere — an explicit check
  that `dependency-consumption.mjs` (forbidden path) is never imported for writing.
- A transition without `continuation: auto` results in nothing enqueued and no preview
  eagerly computed beyond what the DTO already exposes generically.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal step
  id, and no file describes human dispatch as "agent admission."

## Verification

```bash
node --test tools/tests/workflow-continuation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The workflow-definition schema itself (`workflow-continuation-schema`, task 25). The
execution-policy selection UI/storage (`execution-policy-and-mode-selection`, task 26). The
pure queue/scheduling plan itself (`deterministic-sequential-queue`, task 28). The
dependency-satisfaction/epoch/suspension/consumption-recording logic itself
(`dependency-release-and-invalidation`, task 27 — this task only imports its exports). The
`git-finalize-lock.mjs` primitive itself (task 27 — this task only imports and calls it from
the new combined human operation). Any form of concurrent agent execution.

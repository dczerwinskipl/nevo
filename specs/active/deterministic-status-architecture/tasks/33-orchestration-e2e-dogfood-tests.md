---
id: deterministic-status-architecture.orchestration-e2e-dogfood-tests
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/tests/orchestration-e2e.test.mjs
  - tools/tests/orchestration-e2e.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - tools/dashboard/server/**
  - tools/dashboard/ui/**
  - src/**
depends_on: [ dashboard-orchestration-wiring, user-mutation-source-control-finalization, dependency-invalidation-remediation-review ]
semantic_references:
  decisions: [D33, D40, D41, D42, D43, D44, D45]
---

# Task: Orchestration end-to-end dogfood tests

## Goal

Prove the exact flow that failed during real dogfooding now works end to end, sequentially,
race-safely, and evidence-based: `publish` (owning its own commit) → always-shown provider/
mode picker on first Start → checkbox-selecting several tasks → one deterministic queue → the
one atomic admission gate → automatic continuation via real server-side reconciliation
(never a UI callback) → declarative dependency release that remains valid across further
transitions until explicitly invalidated → a pending human decision that does **not** pause
other tasks' agent-owned work → evidence-based dependency-invalidation remediation.

## Implementation constraints

- Test-only task — no production code changes. Compose the real modules from tasks 24–32
  against a realistic fixture change/definition.
- Include one fixture with a newly-authored, non-`implementation`/`review`-named agent step
  to prove no step-id dispatch survived anywhere in the new orchestration code, and to
  exercise `schedulingPriority`'s declarative ordering with an unfamiliar step name.
- Do not implement behavior beyond whatever tasks 24–32 actually shipped.

## Acceptance criteria

- Release remains satisfied after a later, non-invalidating transition (`implementation →
  review` releases, `review → human-verification` does not lapse it).
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- A declared `invalidatesDependencyRelease: true` transition (e.g. `review` fail) revokes a
  previously-valid release — a dependent that hadn't yet started can no longer enter the
  queue via that epoch.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- A single manual Start and a batch Start of several tasks both result in calls to the
  identical `admitExecution` gate — proven by asserting both code paths converge on the same
  function, not two independently-behaving ones.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- Two simultaneous Start requests for the same spec (one manual, one via reconciliation, or
  both manual) never result in two created executions — proven by racing them directly and
  asserting exactly one session/human-activation results.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- After a human "Request changes" result, the resulting agent work (`execution: {session:
  fresh, role: refiner}`) is enqueued and admitted immediately, with no further user action —
  triggered through `human-step-transport.mjs`'s own real hook, not a simulated shortcut.
  `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
- Simulating a server restart between a reconciliation-triggering event and the queue
  recording it restores the missed continuation once the boot/first-request hook runs.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- A remediation group's membership is derived from persisted dependency-consumption records
  naming the invalidated epoch — including an already-`verified` consumer — never from
  current task state or timestamps; the group is fixed one at a time through the same
  sequential queue, reviewed by the combined cross-task pass (including a member added only
  because the review found it needed adjustment), and has its `suspensions` cleared only once
  the whole non-terminal group passes.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- `TaskProjection`/`projectTask()` remains provably pure (same output for the same in-memory
  inputs, no file I/O) even while a `suspensions` entry — read from a separate
  `SuspensionProjection` — blocks that task's `ExecutionReadiness`.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- The first explicit Start for a change with no execution policy always shows the provider +
  mode picker — proven for a provider that would not have needed an explicit mode under the
  retracted conditional logic.
  `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
- A pending human decision on one task does **not** pause a different, independently-eligible
  task's agent-owned work — that other task's own queue item starts normally while the human
  decision is still outstanding.
  `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
- The fixture using a newly-authored, non-`implementation`/`review` step name completes
  through the same orchestration code with zero step-id-specific branches anywhere in the
  exercised call path, and its declared `schedulingPriority` is honored.
  `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
- **Standing invariant, re-asserted end to end:** for one spec/change, there is never more
  than one active agent execution created by deterministic orchestration at any inspected
  point across a full multi-task queue run, including while a human decision is pending on
  another task.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- Publish's own commit is observable as a separate, correctly-attributed commit from the
  agent's own implementation commit.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/orchestration-e2e.test.mjs
node --test tools/tests/orchestration-e2e.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any production code fix — this task only adds end-to-end regression coverage for tasks
24–32's own already-implemented behavior.

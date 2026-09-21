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
  decisions: [D33]
---

# Task: Orchestration end-to-end dogfood tests (corrected — sequential invariant, not parallel starts)

## Goal

Prove the exact flow that failed during real dogfooding now works end to end, **sequentially,
never concurrently**: `publish` (owning its own commit) → checkbox-selecting several tasks →
one deterministic queue → one execution at a time → automatic continuation to a fresh
reviewer session (server-side trigger, not a UI callback) → declarative dependency release
making a sibling task's implementation eligible (never started alongside the releasing
task) → human step auto-activation → `HumanStepSurface` submission → dependency-invalidation
remediation when a release turns out to have been premature.

## Implementation constraints

- Test-only task — no production code changes. Compose the real modules from tasks 24–32
  against a realistic fixture change/definition.
- **Remove every test asserting concurrent execution** (e.g. "selecting two
  independently-ready tasks starts both") — replace with tests proving the sequential
  invariant explicitly (below).
- Include one fixture with a newly-authored, non-`implementation`/`review`-named agent step
  to prove no step-id dispatch survived anywhere in the new orchestration code, and to
  exercise `schedulingPriority`'s declarative ordering with an unfamiliar step name.
- Do not implement behavior beyond whatever tasks 24–32 actually shipped.

## Acceptance criteria

- Selecting several tasks via the checkbox picker creates **one queue**, not several
  concurrent executions.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- **Invariant test:** for one spec/change, there is never more than one active agent
  execution created by deterministic orchestration at any inspected point across a full
  multi-task queue run.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- After the first queued execution finishes, the next runnable item starts automatically —
  proven via the server-side trigger (task 29), with no browser page open during the test.
  `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
- A selected-but-blocked task remains queued (not started, not dropped) until its dependency
  is satisfied, then becomes the next runnable item in its turn.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- A `releasesDependencies` milestone causes a queued dependent to become runnable — proven
  without it ever running alongside the releasing task's own continued execution.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- A same-task automatic continuation (e.g. `implementation → review`) competes for the next
  slot through the identical scheduler as a cross-task queued item — proven by a fixture
  where both are simultaneously eligible and only one starts.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- A human decision point pauses execution (no further queue item starts) until the owner
  submits a result.
  `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
- After a human "Request changes" result, the resulting agent work (`execution: {session:
  fresh, role: refiner}`) is re-enqueued automatically — proven through the same queue, not a
  parallel side path.
  `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
- A fixture reproducing D31's remediation scenario (a released dependency returning backward
  after a downstream task already started, including one already-terminal consumer) is
  suspended (`suspensions`, never `blockedBy`), fixed one at a time through the same
  sequential queue, reviewed by the combined cross-task pass — including a member added only
  because the review found it needed adjustment — and has its suspensions cleared only once
  the whole non-terminal group passes.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- The fixture using a newly-authored, non-`implementation`/`review` step name completes
  through the same orchestration code with zero step-id-specific branches anywhere in the
  exercised call path, and its declared `schedulingPriority` is honored.
  `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
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

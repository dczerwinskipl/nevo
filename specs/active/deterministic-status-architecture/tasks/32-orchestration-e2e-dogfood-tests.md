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
  decisions: []
---

# Task: Orchestration end-to-end dogfood tests

## Goal

Prove the exact flow that failed during real dogfooding now works end to end, as regression
coverage: `publish` (owning its own commit) → `ready` → `start-step` (with resolved execution
policy, no silent mode default) → `workflow step start` (extended `StepContext`) →
implementation → `workflow step finish` → automatic continuation to a fresh reviewer session
→ (declarative dependency release unblocking a sibling task mid-review) → human step
auto-activation → `HumanStepSurface` submission.

## Implementation constraints

- Test-only task — no production code changes. Compose the real modules from tasks 24–31
  (not mocks of them) against a realistic fixture change/definition, verifying the full
  chain rather than re-testing each task's own already-covered unit behavior in isolation.
- Include one fixture with a newly-authored, non-`implementation`/`review`-named agent step
  to prove no step-id dispatch survived anywhere in the new orchestration code (extending the
  existing item-15-style generic-fixture proof from `execution-readiness-policy` to this
  pass's own new code).
- Do not implement OQ-A/OQ-B-dependent behavior in this test suite beyond whatever tasks 28/29
  actually shipped — if those were left partial pending owner answers, this task's coverage
  reflects that honestly rather than asserting unimplemented behavior.

## Acceptance criteria

- A fixture task's full flow (publish → start-step → implement → finish → auto-continue to
  review → human-verification auto-activation → submit) completes with no manual
  intervention beyond the genuine human decision point.
  `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
- A sibling task blocked only by the first task's own review (not its implementation) becomes
  startable once the `releasesDependencies` milestone fires, before the first task reaches a
  terminal transition.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- The fixture using a newly-authored, non-`implementation`/`review` step name completes
  through the same orchestration code with zero step-id-specific branches anywhere in the
  exercised call path.
  `automated: node --test tools/dashboard/tests/orchestration-e2e.test.mjs`
- Publish's own commit is observable as a separate, correctly-attributed commit from the
  agent's own implementation commit (proving D29/Finding 11 is actually fixed, not just
  unit-tested in isolation).
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`
- A fixture reproducing D31's remediation scenario (a released dependency returning
  backward after a downstream task already started against it) is suspended, fixed as a
  group via the batch orchestrator, reviewed by the combined cross-task pass — including a
  member added only because the review found it needed adjustment — and has its suspension
  cleared only once the whole group passes.
  `automated: node --test tools/tests/orchestration-e2e.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/orchestration-e2e.test.mjs
node --test tools/tests/orchestration-e2e.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any production code fix — this task only adds end-to-end regression coverage for tasks
24–31's own already-implemented behavior.

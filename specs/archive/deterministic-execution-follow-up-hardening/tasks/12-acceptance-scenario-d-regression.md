---
id: acceptance-scenario-d-regression
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/acceptance-scenarios-a-through-d.md
depends_on:
  - terminal-reconciliation-adopts-outcome
allowed_paths:
  - tools/tests/scenario-d-no-concurrent-writers.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/**
  - src/**
semantic_references:
  dependency_contracts: [terminal-reconciliation-adopts-outcome]
---

# Task: Acceptance scenario D — no concurrent writers (regression)

## Dependencies

`terminal-reconciliation-adopts-outcome` (this test must run after Area A/B land, to catch
any regression they might introduce, even though no functional change is expected here).

## Goal

New orchestration-level regression test, tied explicitly to this specification's own
acceptance criteria, proving that a still-live (non-terminal) execution's claim is never
acquired by a second execution for the same worktree/task — through the real admission path,
not only the workspace-writer primitive (which already has lower-level coverage).

## Acceptance criteria

- With agent X's execution admitted and its turn still live (not terminal), a second
  `admitAgentExecution` call for the same task does not return `admitted: true` and does not
  yield a second live claim. `automated: node --test tools/tests/scenario-d-no-concurrent-writers.test.mjs`
- The same holds when agent Y targets the same task via a different route (fresh vs. reuse
  execution route) than agent X used. `automated: node --test tools/tests/scenario-d-no-concurrent-writers.test.mjs`
- Once agent X's turn is confirmed terminal (any outcome), agent Y's next attempt succeeds —
  proving the block is specific to liveness, not a permanent lockout introduced by Area A/B.
  `automated: node --test tools/tests/scenario-d-no-concurrent-writers.test.mjs`

## Verification

```bash
node --test tools/tests/scenario-d-no-concurrent-writers.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any code change to acquisition/contention logic — this task is test-only, per the area's
"no functional change expected" scope.

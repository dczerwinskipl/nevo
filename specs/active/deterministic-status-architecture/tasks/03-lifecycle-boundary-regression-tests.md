---
id: deterministic-status-architecture.lifecycle-boundary-regression-tests
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/lifecycle-boundary-guards.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/tests/lifecycle-boundary-regression.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/specs/workflow/**
  - tools/dashboard/**
  - src/**
depends_on: [ legacy-mutation-guard, deterministic-mutation-guard ]
semantic_references:
  decisions: [D8]
---

# Task: Lifecycle boundary regression tests

## Goal

Add the architecture/regression protection this change requires: a static import-boundary
check between legacy and deterministic mutation modules (now including
`tools/specs/lifecycle-primitives.mjs` per D8), plus a full side-effect "no mutation before
guard failure" and "omitted workflow mode stays legacy" regression suite covering both
guard tasks together.

## Dependencies

`legacy-mutation-guard`, `deterministic-mutation-guard` — this task tests both guards'
final shape.

## Implementation constraints

- The import-boundary check is static (parses/greps each module's own `import`/`require`
  statements) — it does not execute code to detect a violation, so it fails fast and
  deterministically in CI.
- Scope the check precisely: `tools/specs/{approve,start,complete,verify}/**` must not
  import from `tools/specs/workflow/**`'s mutation entry points
  (`cli.mjs`/`step-context.mjs`/`finish-operation.mjs`/the publish operation); those files
  must not import from `tools/specs/{approve,start,complete,verify}/**`; and per D8, no
  file under `tools/specs/workflow/**` may import `tools/specs/lifecycle-primitives.mjs` at
  all. `resolveWorkflowMode()` (`compatibility.mjs`) and the generic store writers
  (`store.mjs`) are explicitly exempt — the test asserts they remain importable by both
  sides.
- Side-effect assertions must cover, for every failing guard call: `change.yaml`
  byte-for-byte unchanged, git `HEAD` unchanged, current branch unchanged (no new branch
  created), working tree unchanged (`git status --porcelain` empty of new changes), no
  `workflow_progress`/workflow-operation state created, and no execution session created.

## Acceptance criteria

- A spec with no `workflow` field completes the full legacy lifecycle (`approve`→`start`→
  `complete`→`verify`) unchanged (brief regression test #1, #18).
  `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`
- A spec with explicit `workflow.mode: legacy` behaves identically (brief regression test
  #2). `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`
- Each of the four legacy commands against a deterministic spec, and each of the
  deterministic commands against a legacy spec, fails and leaves every side effect listed
  above unchanged — asserted by capturing and diffing each, not by inspecting only the
  error message (brief regression tests #3, #4, #20; corrective-pass item 12).
  `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`
- The static import-boundary check finds zero violations in either direction, including the
  `lifecycle-primitives.mjs` exclusion (brief regression tests #16, #17; corrective-pass
  item 14). `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`

## Verification

```bash
node --test tools/tests/lifecycle-boundary-regression.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The guards' own implementation (owned by the two dependency tasks). The executor-invariant
guard's own regression coverage — task `step-executor-guard`.

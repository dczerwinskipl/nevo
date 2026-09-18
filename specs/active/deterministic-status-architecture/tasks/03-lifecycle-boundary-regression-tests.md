---
id: deterministic-status-architecture.lifecycle-boundary-regression-tests
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/lifecycle-boundary-guards.md
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
---

# Task: Lifecycle boundary regression tests

## Goal

Add the architecture/regression protection this change requires: a static import-boundary
check between legacy and deterministic mutation modules, plus a "no mutation before guard
failure" and "omitted workflow mode stays legacy" regression suite covering both guard
tasks together.

## Dependencies

`legacy-mutation-guard`, `deterministic-mutation-guard` — this task tests both guards'
final shape.

## Implementation constraints

- The import-boundary check is static (parses/greps each module's own `import`/`require`
  statements) — it does not execute code to detect a violation, so it fails fast and
  deterministically in CI.
- Scope the check precisely: `tools/specs/{approve,start,complete,verify}/**` must not
  import from `tools/specs/workflow/**`'s mutation entry points
  (`cli.mjs`/`step-context.mjs`/`finish-operation.mjs`/the publish operation once it
  exists), and those files must not import from
  `tools/specs/{approve,start,complete,verify}/**`. Shared, read-only utilities
  (`resolveWorkflowMode`, `lifecycle-primitives.mjs`, `store.mjs`) are explicitly exempt —
  the test asserts they remain importable by both sides.

## Acceptance criteria

- A spec with no `workflow` field completes the full legacy lifecycle (`approve`→`start`→
  `complete`→`verify`) unchanged (brief regression test #1, #18).
  `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`
- A spec with explicit `workflow.mode: legacy` behaves identically (brief regression test
  #2). `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`
- Each of the four legacy commands against a deterministic spec, and each of the three
  deterministic commands against a legacy spec, fails and leaves `change.yaml` byte-for-byte
  unchanged — asserted by diffing the file before/after the failing call, not by inspecting
  only the error message (brief regression tests #3, #4, #20).
  `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`
- The static import-boundary check finds zero violations in either direction (brief
  regression tests #16, #17). `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`

## Verification

```bash
node --test tools/tests/lifecycle-boundary-regression.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The guards' own implementation (owned by the two dependency tasks) — this task only tests
the resulting, finished behavior.

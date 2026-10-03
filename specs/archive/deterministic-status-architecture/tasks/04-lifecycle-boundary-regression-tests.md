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
depends_on: [ legacy-mutation-guard, deterministic-mutation-guard, status-vocabulary-extraction ]
semantic_references:
  decisions: [D8]
---

# Task: Lifecycle boundary regression tests

## Goal

Add the architecture/regression protection this change requires: a static import-boundary
check between legacy and deterministic mutation modules, plus a full side-effect "no
mutation before guard failure" and "omitted workflow mode stays legacy" regression suite
covering both guard tasks together.

## Dependencies

`legacy-mutation-guard`, `deterministic-mutation-guard` — this task tests both guards'
final shape. `status-vocabulary-extraction` — the import-boundary check below asserts zero
`lifecycle-primitives.mjs` imports under `tools/specs/workflow/**`; that is only true once
this task's two pre-existing imports have actually been removed.

## Implementation constraints

- The import-boundary check is static (parses/greps each module's own `import`/`require`
  statements) — it does not execute code to detect a violation, so it fails fast and
  deterministically in CI.
- Scope the check precisely: `tools/specs/{approve,start,complete,verify}/**` must not
  import from `tools/specs/workflow/**`'s mutation entry points
  (`cli.mjs`/`step-context.mjs`/`finish-operation.mjs`/the publish operation); those files
  must not import from `tools/specs/{approve,start,complete,verify}/**`; and no file under
  `tools/specs/workflow/**` may import `tools/specs/lifecycle-primitives.mjs` (D8 —
  post-extraction, zero such imports exist). `resolveWorkflowMode()` (`compatibility.mjs`),
  the generic store writers (`store.mjs`), and `tools/specs/status-vocabulary.mjs` are
  explicitly exempt — the test asserts they remain importable by both sides.

## Acceptance criteria

- A spec with no `workflow` field completes the full legacy lifecycle (`approve`→`start`→
  `complete`→`verify`) unchanged (brief regression test #1, #18).
  `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`
- A spec with explicit `workflow.mode: legacy` behaves identically (brief regression test
  #2). `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`
- Each of the four legacy commands against a deterministic spec, and each of
  `workflow step start`/`workflow step finish` against a legacy spec, fails and leaves
  `change.yaml`, git `HEAD`, the current branch, the working tree, and any workflow-
  operation/execution-session state byte-for-byte unchanged — asserted by capturing and
  diffing each, not by inspecting only the error message (brief regression tests #3, #4,
  #20; corrective-pass-1 item 12). `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`
- The static import-boundary check finds zero violations in either direction, including
  zero `lifecycle-primitives.mjs` imports under `tools/specs/workflow/**` (brief regression
  tests #16, #17; corrective-pass-1 item 14; corrective-pass-2 D8).
  `automated: node --test tools/tests/lifecycle-boundary-regression.test.mjs`

## Verification

```bash
node --test tools/tests/lifecycle-boundary-regression.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The guards' own implementation (owned by the two dependency tasks). The
`TERMINAL_STATUSES` extraction itself (owned by `status-vocabulary-extraction`). The
executor-invariant guard's own regression coverage — task `step-executor-guard`.

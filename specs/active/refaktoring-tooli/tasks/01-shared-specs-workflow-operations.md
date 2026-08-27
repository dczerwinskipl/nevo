---
id: refaktoring-tooli.shared-specs-workflow-operations
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/dashboard-server-runtime.md
    - specs/active/refaktoring-tooli/areas/specs-core-and-lifecycle.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/actions.mjs
    - tools/specs/gates.mjs
    - tools/specs/lifecycle.mjs
  optional: []
allowed_paths:
  - tools/dashboard/server/actions.mjs
  - tools/specs/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1]
  constraints: [C1, C2, C4, C5, C7]
---

# Task: Shared specs workflow operations and in-process action execution

## Goal

Eliminate blocking synchronous subprocess execution (`execFileSync`) in `tools/dashboard/server/actions.mjs` on HTTP request paths by extracting reusable application operations for gate evaluation and action checks, consumed directly in-process by both the CLI and the dashboard server.

## Problem

- `tools/dashboard/server/actions.mjs` executes `execFileSync` to invoke `node tools/specs.mjs <action> <slug> --check` synchronously during HTTP request handling (in `taskGate`, `finalizeGate`, and `loadSpecificationActions`), spawning multiple child processes per request.
- In `getLocalBranchTracking`, it executes `execFileSync('git', ...)` synchronously on the request path.
- Spawning the project's own CLI as a subprocess to execute internal operations duplicates execution paths and blocks the Node event loop on HTTP requests, violating §2.3 and §9.2 of `node-tooling-guidelines.md`.

## Expected outcome

- Gate check logic (`taskGate`, `finalizeGate`) is evaluated by calling shared application functions in `tools/specs/` directly in-process rather than spawning child CLI processes.
- Git branch tracking information is queried asynchronously or via existing asynchronous Git adapters.
- Action execution (`executeSpecificationAction`) preserves asynchronous execution, progress streaming, cancellation, and error reporting without blocking server responsiveness.

## Preserved contracts & behavior

- The REST endpoint `/api/specs/:slug/actions` and action execution endpoints must return identical JSON payloads and status codes.
- Gate evaluation facts (verification checks, PR status, branch upstream/ahead/behind tracking) must produce identical results.

## Verification

```text
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

- Redesigning the entire dashboard server routing structure (handled in task 04).

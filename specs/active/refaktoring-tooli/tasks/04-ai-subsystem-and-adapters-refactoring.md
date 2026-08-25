---
id: refaktoring-tooli.ai-subsystem-and-adapters-refactoring
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/ai-subsystem-and-adapters.md
    - docs/development/node-tooling-guidelines.md
    - tools/ai/**
  optional: []
allowed_paths:
  - tools/ai/**
  - tools/tests/ai/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D3]
  constraints: [C1, C2, C4, C6, C7]
---

# Task: AI subsystem and adapters refactoring

## Goal

Refactor provider adapters (`antigravity-adapter.mjs`, `codex-adapter.mjs`, `claude-adapter.mjs`), turn runtime (`turn-runtime.mjs`), and `binding-service.mjs`, separating pure wire protocol encoding/decoding from asynchronous child process execution and `AbortSignal` cancellation handling.

## Implementation constraints

- Separate event stream parsing and message transformation (pure functions) from child process and stream descriptor management.
- Ensure deterministic termination of child processes upon cancellation (`AbortSignal`), timeouts, or failures to clean up system resources.
- Organize modules within `tools/ai/`:
  - `tools/ai/protocol/` (pure transformations and serialization for Claude, Codex, Antigravity)
  - `tools/ai/turn-runtime.mjs` (turn execution state machine and event orchestration)
  - `tools/ai/binding-service.mjs` (binding agent session contexts with tasks and specifications)
- No adapter module should exceed ~300–400 LOC.

## Acceptance criteria

1. Wire protocol parsing for individual providers is isolated in pure functions and unit tested. `automated: node --test tools/tests/ai/**/*.test.mjs`
2. Cancellation via `AbortSignal` reliably terminates turn execution and closes child processes. `automated: node --test tools/tests/ai/**/*.test.mjs`
3. All AI adapter tests (`antigravity`, `claude`, `codex`, `mock`) pass cleanly. `automated: node --test tools/tests/ai/**/*.test.mjs`

## Verification

```text
node --test tools/tests/ai/**/*.test.mjs
node tools/specs.mjs validate
```

## Out of scope

- Modifying event schemas in `contracts.mjs` or integrating new LLM providers.

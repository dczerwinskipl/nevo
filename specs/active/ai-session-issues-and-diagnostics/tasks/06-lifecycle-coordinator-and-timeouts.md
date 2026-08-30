---
id: ai-session-issues-and-diagnostics.lifecycle-coordinator-and-timeouts
status: draft
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/canonical-turn-work-model.md
    - specs/active/ai-session-issues-and-diagnostics/areas/lifecycle-diagnostics-and-timeouts.md
    - docs/development/node-tooling-guidelines.md
    - tools/dashboard/server/ai/sessions/turns/runtime.mjs
    - tools/dashboard/server/ai/providers/process-termination.mjs
  optional:
    - specs/active/ai-session-issues-and-diagnostics/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/contracts.mjs
  - tools/dashboard/server/ai/model/**
  - tools/dashboard/server/ai/diagnostics/**
  - tools/dashboard/server/ai/sessions/turns/**
  - tools/dashboard/server/ai/providers/process-termination.mjs
  - tools/dashboard/server/ai/providers/registry.mjs
  - tools/dashboard/tests/ai-turn-runtime.test.mjs
  - tools/dashboard/tests/ai-lifecycle-diagnostics.test.mjs
  - tools/dashboard/tests/session-states-integration.test.mjs
forbidden_paths:
  - tools/dashboard/server/ai/providers/claude/**
  - tools/dashboard/server/ai/providers/codex/**
  - tools/dashboard/server/ai/providers/antigravity/**
  - tools/dashboard/ui/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D3, D4, D7, D8, D10]
  constraints: [C3, C7, C8, C9, C10, C11, C12, C14, C15]
  dependency_contracts: [neutral-lifecycle-diagnostics]
---

# Task: Implement the lifecycle coordinator and timeout policy

## Goal

Replace first-terminal-wins side effects with one serialized lifecycle coordinator that owns Turn
status/outcome, provider-operation evidence, tool-derived active/waiting state, cancellation, and all
neutral timeout decisions.

## Requirements

- Make the coordinator the sole Turn transition writer and validate the canonical discriminated
  status.
- Assign Work sequence at accepted creation and update existing items in place.
- Track multiple open ToolInvocations and pending Interaction independently.
- Derive active tool/model, waiting for tool/provider, and requires-attention only from accepted
  evidence.
- Record cancellation or timeout intent before invoking provider cleanup.
- Implement the timeout table and defaults exactly: bounded startup/cleanup, tool-aware/user-aware
  protocol silence, tool/max-Turn disabled by default.
- Keep provider process/operation release as a separate readiness barrier after terminal outcome.
- Close unresolved invocations with non-success and explicit inferred closure cause.
- Add a bounded transitional adapter-callback bridge only if required to keep unmigrated providers
  operational. It lives below the runtime boundary, targets the canonical model, and is deleted in
  Task 13.

## Acceptance criteria

1. Tests cover every legal/illegal Turn transition and accepted/late signal precedence.
   `automated: node --test tools/dashboard/tests/ai-turn-runtime.test.mjs`
2. A real-adapter-shaped timeout/cancel race persists `failed` with `timeout/protocol-silence`, not
   user cancellation. `automated: node --test tools/dashboard/tests/ai-turn-runtime.test.mjs`
3. Long tool execution and waiting-for-tool do not fire protocol silence; waiting-for-provider can
   fire only after qualifying activity policy expires. `automated: node --test tools/dashboard/tests/ai-turn-runtime.test.mjs`
4. Failed tool followed by later Work can end in completed Turn, with exact ordering retained.
   `automated: node --test tools/dashboard/tests/ai-turn-runtime.test.mjs`
5. User cancel, provider completion, process exit, shutdown/restart, and cleanup barrier races follow
   the lifecycle area rules and are traceable. `automated: node --test tools/dashboard/tests/ai-turn-runtime.test.mjs`
6. Browser/SSE disconnect never mutates provider Turn lifecycle.
   `automated: node --test tools/dashboard/tests/session-states-integration.test.mjs`

## Verification

```text
node --test tools/dashboard/tests/ai-turn-runtime.test.mjs tools/dashboard/tests/ai-lifecycle-diagnostics.test.mjs tools/dashboard/tests/session-states-integration.test.mjs
```

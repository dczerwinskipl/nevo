---
id: ai-sessions-live-chat-integration.ai-session-context-cli-preflight
status: draft
change: ai-sessions-live-chat-integration
depends_on: [local-ai-registry-and-manual-attach]
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/local-session-registration.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - tools/specs.mjs
    - tools/specs/service.mjs
    - tools/tests/handler-testability.test.mjs
    - tools/tests/context.test.mjs
  optional:
    - tools/tests/cli-smoke.test.mjs
allowed_paths:
  - tools/ai/**
  - tools/specs.mjs
  - tools/specs/**
  - tools/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
  - .claude/**
semantic_references:
  decisions: [D6, D7]
  constraints: [C4, C15, C16]
  dependency_contracts: [local-ai-registry-and-manual-attach]
---

# Task: AI session context CLI preflight

## Goal

Create one handler-level invocation pipeline that opportunistically registers trustworthy process-scoped AI session context before spec-related CLI logic without adding a required registration command to agent workflow.

## Dependencies

Depends on the local registry/manual attachment service from task 10.

## Implementation constraints

- Place reusable preflight below Commander so exported handler tests and non-CLI callers can inject and exercise it.
- Keep context extraction provider-neutral; exact Claude delivery is task 12.
- Explicit-spec commands resolve selector to `specId`, register valid context, then execute unchanged original logic.
- `next` registers only after its deterministic selected change is known.
- Commands that select no one spec (`list`, `validate`, `check`, `generate`) do not register.
- Absent context is a strict no-op. Malformed/untrusted context emits a diagnostic and does not mutate registry or block the original command unless it creates a security/path ambiguity.
- Preserve command output, exit codes, recovery errors, and direct handler testability after preflight.
- Do not persist invocation context outside the relation produced by successful registration.

## Acceptance criteria

1. Every spec-scoped handler uses one shared preflight path and direct imports can inject fake context/registry dependencies. `automated: node --test tools/tests/ai-cli-preflight.test.mjs tools/tests/handler-testability.test.mjs`
2. Valid context is registered before `context`, `start`, and other explicit-spec handler logic; `next` registers the selected spec only after selection. `automated: node --test tools/tests/ai-cli-preflight.test.mjs`
3. No-context invocation produces identical outputs/exit behavior for representative existing commands. `automated: node --test tools/tests/ai-cli-preflight.test.mjs tools/tests/cli-smoke.test.mjs`
4. Invalid context cannot create a relation, overwrite another session, or suppress the original command. `automated: node --test tools/tests/ai-cli-preflight.test.mjs`
5. Two concurrent invocation contexts never share or overwrite a global current session. `automated: node --test tools/tests/ai-cli-preflight.test.mjs`

## Verification

```text
node --test tools/tests/ai-cli-preflight.test.mjs tools/tests/handler-testability.test.mjs tools/tests/cli-smoke.test.mjs
node tools/specs.mjs check
```

## Out of scope

- Claude hook configuration, provider process management, or requiring context for any command.

---
id: multi-provider-agent-sessions.session-binding-and-execution-context
status: draft
change: multi-provider-agent-sessions
context:
  required:
    - specs/active/multi-provider-agent-sessions/overview.md
    - specs/active/multi-provider-agent-sessions/areas/session-binding-and-context.md
    - specs/active/multi-provider-agent-sessions/tasks/01-provider-neutral-core-and-capabilities.md
    - tools/ai/contracts.mjs
    - tools/specs/service.mjs
allowed_paths:
  - tools/ai/binding-service.mjs
  - tools/ai/contracts.mjs
  - tools/specs.mjs
  - tools/tests/agent-binding.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/src/**
semantic_references:
  decisions: [D2, D6]
  constraints: [C3, C6, C10]
---

# Task: Session binding and execution context

## Goal

Implement the shared `AgentSessionBindingService` and CLI `AgentExecutionContext`, supporting canonical `spec-slug`/`spec-id` resolution, history-oriented many-to-one bindings of `(provider, providerSessionId)` to specs and tasks, auto-binding in command workflows, and the `agent-session attach` CLI utility.

## Requirements

- Implement `AgentSessionBindingService` in `tools/ai/binding-service.mjs` to bind, list, and unbind sessions identified by `(provider, providerSessionId)` associated with `specId` and optional `taskId`.
- Implement canonical spec resolver handling both human-readable `slug` and immutable UUID `spec_id`.
- Implement `agent-session attach` command in `tools/specs.mjs`:
  `node tools/specs.mjs agent-session attach --spec <slug-or-id> [--task <id>] --provider <provider> --session-id <providerSessionId>`
- Implement `AgentExecutionContext` reader supporting environment-variable-based session propagation (`NEVO_AGENT_PROVIDER`, `NEVO_AGENT_PROVIDER_SESSION_ID`).
- Implement automatic binding in common CLI commands (`spec refine`, `spec review`, `task start`) when `AgentExecutionContext` is present.
- Store all bindings in `.nevo-ai-local/sessions.json` without committing runtime session data to git.

## Verification

```bash
node --test tools/tests/agent-binding.test.mjs
node tools/specs.mjs validate
```

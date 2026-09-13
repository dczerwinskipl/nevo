---
id: agent-workflow-protocol-and-flow-hardening.session-task-binding-and-workflow-server-endpoints
status: draft
change: agent-workflow-protocol-and-flow-hardening
depends_on:
  - workflow-protocol-git-hardening-and-human-decisions
context:
  required:
    - specs/active/agent-workflow-protocol-and-flow-hardening/overview.md
    - specs/active/agent-workflow-protocol-and-flow-hardening/owner-decisions.md
    - specs/active/agent-workflow-protocol-and-flow-hardening/areas/03-human-verification-and-loop-transitions.md
    - specs/active/agent-workflow-protocol-and-flow-hardening/areas/04-session-task-binding-and-chat-experience.md
    - tools/dashboard/server/ai/sessions/binding-service.mjs
    - tools/dashboard/server/specs/actions.mjs
    - tools/dashboard/server/specs/routes.mjs
    - tools/specs.mjs
  optional:
    - tools/dashboard/server/ai/routes.mjs
    - tools/dashboard/server/ai/contracts.mjs
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/dashboard/server/ai/sessions/binding-service.mjs
  - tools/dashboard/server/specs/actions.mjs
  - tools/dashboard/server/specs/routes.mjs
  - tools/dashboard/server/ai/routes.mjs
  - tools/specs.mjs
  - tools/specs/workflow/cli.mjs
  - tools/dashboard/tests/binding-service.test.mjs
  - tools/dashboard/tests/ai-server.test.mjs
  - tools/dashboard/tests/specs-actions.test.mjs
  - specs/active/agent-workflow-protocol-and-flow-hardening/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/ui/**
semantic_references:
  decisions: [D2, D3, D7]
  constraints: [C7, C8]
---

# Task: Session ↔ task binding and workflow server endpoints

## Goal

Extend `AgentSessionBindingService` to model and persist historical, many-to-many `SessionTaskBinding` records capturing task, step, and attempt linkages without overwriting earlier task associations; wire ambient execution context binding into CLI workflow start/finish handlers; and implement dashboard server API endpoints to query tasks associated with a conversation and execute human verification workflow decisions (`approve` and `request-changes`).

## Implementation constraints

- **Session ↔ Task Historical Binding:**
  - In `tools/dashboard/server/ai/sessions/binding-service.mjs`:
    - Support storing multiple task bindings per session in `.nevo-ai-local/sessions/<specId>.json`.
    - Record fields: `{ provider, providerSessionId, specId, taskId, step, attempt, purpose, mode, model, createdAt, lastSeenAt }`.
    - Do not overwrite or mutate single `taskId` on existing session binding when a new task is bound; append or update the specific `(sessionId, specId, taskId)` entry.
    - Implement `getTasksForSession(provider, providerSessionId, specId)` returning all tasks associated with that session, ordered by `lastSeenAt` descending.
    - Implement `getSessionsForTask(specId, taskId)` returning all sessions that have worked on that task.
- **Ambient Context Auto-Binding in CLI / Workflow Handlers:**
  - In `tools/specs.mjs` and `tools/specs/workflow/cli.mjs`:
    - Connect `autoBindAgentSession` into `handleWorkflowStepStart` and `handleWorkflowStepFinish` so that whenever `NEVO_AGENT_PROVIDER` and `NEVO_AGENT_PROVIDER_SESSION_ID` are present in `process.env`, a binding record is created/updated with current `taskId`, `step`, and `attempt`.
- **Workflow Server Endpoints:**
  - In `tools/dashboard/server/specs/routes.mjs` (or `tools/dashboard/server/specs/actions.mjs`):
    - Implement endpoint `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision`:
      - Validates body contains `decision` ('approve' or 'request-changes') and optional `feedback` string.
      - Delegates to `handleWorkflowVerifyHuman` with `--approve` or `--request-changes --feedback`.
      - Returns updated task details and workflow progress.
  - In `tools/dashboard/server/ai/routes.mjs`:
    - Include bound task summaries in the session details response (`/api/ai/sessions/:sessionId`), providing the frontend with all tasks associated with the conversation.

## Acceptance criteria

1. `AgentSessionBindingService` supports a single session binding to multiple distinct tasks over time without data loss or overwriting. `automated: node --test tools/dashboard/tests/binding-service.test.mjs`
2. `getTasksForSession` returns all historical task bindings for a given session. `automated: node --test tools/dashboard/tests/binding-service.test.mjs`
3. Running `workflow step start` with ambient `NEVO_AGENT_PROVIDER` and `NEVO_AGENT_PROVIDER_SESSION_ID` automatically creates a `SessionTaskBinding` with current step and attempt. `automated: node --test tools/dashboard/tests/binding-service.test.mjs`
4. Server endpoint `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` with `approve` transitions task to `verified`. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
5. Server endpoint `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` with `request-changes` and `feedback` transitions task to `implementation` attempt 2 with feedback persisted. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
6. `GET /api/ai/sessions/:sessionId` includes bound tasks metadata. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
7. `node tools/specs.mjs check` passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/dashboard/tests/binding-service.test.mjs
node --test tools/dashboard/tests/ai-server.test.mjs
node tools/specs.mjs check
```

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
    - specs/active/agent-workflow-protocol-and-flow-hardening/areas/05-end-to-end-orchestration-and-dispatch.md
    - tools/dashboard/server/ai/sessions/service.mjs
    - tools/dashboard/server/ai/sessions/binding-service.mjs
    - tools/dashboard/server/specs/actions.mjs
    - tools/dashboard/server/specs/routes.mjs
    - tools/specs.mjs
  optional:
    - tools/dashboard/server/ai/routes.mjs
    - tools/dashboard/server/ai/contracts.mjs
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/dashboard/server/ai/sessions/service.mjs
  - tools/dashboard/server/ai/sessions/binding-service.mjs
  - tools/dashboard/server/ai/providers/claude/provider.mjs
  - tools/dashboard/server/ai/providers/antigravity/provider.mjs
  - tools/dashboard/server/ai/providers/codex/app-server-client.mjs
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
  decisions: [D2, D3, D7, D8, D9]
  constraints: [C7, C8, C9, C10, C11]
---

# Task: Session ↔ task binding, trusted identity propagation, and server endpoints

## Goal

Extend `AgentSessionBindingService` to model and persist historical, many-to-many `SessionTaskBinding` records; propagate trusted session execution context (`NEVO_SESSION_ID`, `NEVO_AGENT_PROVIDER`) into provider child processes with seamless first-turn identity resolution; wire ambient execution context auto-binding into CLI workflow start/finish handlers; provide server endpoints to initiate agent-owned steps (`start-work`) with hidden `<nevo-execution-context>` prompt enrichment and execute human verification decisions (`approve` / `request-changes`); and compute server-side `availableActions` projections for tasks.

## Implementation constraints

- **Session ↔ Task Historical Binding:**
  - In `tools/dashboard/server/ai/sessions/binding-service.mjs`:
    - Support storing multiple task bindings per session in `.nevo-ai-local/sessions/<specId>.json`.
    - Record fields: `{ provider, providerSessionId, specId, taskId, step, attempt, purpose, mode, model, createdAt, lastSeenAt }`.
    - Do not overwrite or mutate single `taskId` on existing session binding when a new task is bound; append or update the specific `(sessionId, specId, taskId)` entry.
    - Implement `getTasksForSession(provider, providerSessionId, specId)` returning all tasks associated with that session, ordered by `lastSeenAt` descending.
    - Implement `getSessionsForTask(specId, taskId)` returning all sessions that have worked on that task.
- **Trusted Session Identity Propagation & First-Turn Lifecycle:**
  - In `tools/dashboard/server/ai/sessions/service.mjs`:
    - Allocate canonical `sessionId` UUID at session creation time before turn 1 starts.
    - Inject `NEVO_SESSION_ID = sessionId`, `NEVO_AGENT_PROVIDER = provider`, `NEVO_SPEC_ID = specId`, and `NEVO_TASK_ID = taskId` into provider process environment options (`childEnv` in Claude, `spawnEnv` in Antigravity/Codex).
    - If native provider conversation allocation is lazy (`established: false`), maintain the binding under `sessionId`; when native ID is reported via `onSessionEstablished`, correlate the native ID in `bindingService` without dropping prior records.
- **Ambient Context Auto-Binding in CLI / Workflow Handlers:**
  - In `tools/specs.mjs` and `tools/specs/workflow/cli.mjs`:
    - Connect `autoBindAgentSession` into `handleWorkflowStepStart` and `handleWorkflowStepFinish` so that whenever `NEVO_SESSION_ID` and `NEVO_AGENT_PROVIDER` are present in `process.env`, a binding record is created/updated with current `taskId`, `step`, and `attempt`.
- **Workflow Server Endpoints & Prompt Enrichment:**
  - In `tools/dashboard/server/specs/routes.mjs` / `actions.mjs`:
    - Implement `POST /api/specs/:slug/tasks/:taskId/workflow/start-work`:
      - Resolves or creates session via `AgentSessionService`.
      - Dispatches turn via `startTurn` with clean user message (`"Implement task <taskId>"`) and enriched provider prompt containing the hidden `<nevo-execution-context>` bootstrap block.
      - Returns session metadata and initial turn ID.
    - Implement `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision`:
      - Accepts `{ decision: 'approve' | 'request-changes', feedback?: string }`.
      - Invokes `handleWorkflowVerifyHuman` with `--approve` or `--request-changes --feedback`.
      - Returns updated task details and workflow progress.
    - Project `availableActions` on task read models based on current `workflow_progress.state`, `step`, and history.
  - In `tools/dashboard/server/ai/routes.mjs`:
    - Include bound task summaries in `/api/ai/sessions/:sessionId`.

## Acceptance criteria

1. `AgentSessionBindingService` supports a single session binding to multiple distinct tasks over time without data loss or overwriting. `automated: node --test tools/dashboard/tests/binding-service.test.mjs`
2. `getTasksForSession` returns all historical task bindings for a given session. `automated: node --test tools/dashboard/tests/binding-service.test.mjs`
3. Running `workflow step start` with ambient `NEVO_SESSION_ID` and `NEVO_AGENT_PROVIDER` automatically creates a `SessionTaskBinding` with current step and attempt. `automated: node --test tools/dashboard/tests/binding-service.test.mjs`
4. First-turn CLI execution succeeds and binds properly before native provider session ID is established. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
5. Endpoint `POST /api/specs/:slug/tasks/:taskId/workflow/start-work` creates a turn with hidden `<nevo-execution-context>` and clean user message. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
6. Endpoint `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` with `approve` transitions task to `verified`. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
7. Endpoint `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` with `request-changes` transitions task to `implementation` attempt 2 with feedback persisted. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
8. Task read model includes `availableActions` matching the state-action matrix. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
9. `node tools/specs.mjs check` passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/dashboard/tests/binding-service.test.mjs
node --test tools/dashboard/tests/ai-server.test.mjs
node --test tools/dashboard/tests/specs-actions.test.mjs
node tools/specs.mjs check
```

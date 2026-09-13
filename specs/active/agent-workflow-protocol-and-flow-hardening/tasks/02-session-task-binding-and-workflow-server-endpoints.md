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
    - specs/active/agent-workflow-protocol-and-flow-hardening/areas/05-end-to-end-session-and-task-bootstrap.md
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
  - tools/dashboard/server/ai/providers/codex/provider.mjs
  - tools/dashboard/server/specs/actions.mjs
  - tools/dashboard/server/specs/routes.mjs
  - tools/dashboard/server/ai/routes.mjs
  - tools/specs.mjs
  - tools/specs/workflow/cli.mjs
  - tools/dashboard/tests/binding-service.test.mjs
  - tools/dashboard/tests/ai-server.test.mjs
  - tools/dashboard/tests/specs-actions.test.mjs
  - tools/dashboard/tests/session-task-bootstrap.test.mjs
  - specs/active/agent-workflow-protocol-and-flow-hardening/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/ui/**
semantic_references:
  decisions: [D2, D3, D7, D8, D9]
  constraints: [C7, C8, C9, C10, C11]
---

# Task: Agent execution bootstrap, trusted session context, session-task binding, and workflow server endpoints

## Goal

Implement the complete agent execution bootstrap and identity propagation pipeline: generate canonical Nevo session UUIDs, propagate trusted ambient execution context (`NEVO_SESSION_ID`, `NEVO_AGENT_PROVIDER`) to provider child processes across Claude, Antigravity, and Codex, wire zero-guess CLI auto-binding in `tools/specs.mjs`, support historical many-to-many `SessionTaskBinding` with explicit `activeTaskId` switching, inject minimal hidden `[Nevo Workflow Context]` headers on first turns, deliver the human verification decision endpoint (`POST .../human-decision`), and project authoritative `availableActions` for tasks.

## Implementation constraints

- **Trusted Session Identity & Canonical UUID (`D9`):**
  - In `tools/dashboard/server/ai/sessions/service.mjs`:
    - Synchronously allocate an authoritative canonical `sessionId` UUID at session creation time (`createSession`).
    - If provider allocates conversation IDs lazily (e.g. Claude without native pre-allocation), record the binding under `sessionId` with `established: false`.
    - When native ID is confirmed via `onSessionEstablished` / `setProviderSessionId`, call `bindingService.markSessionEstablished` to correlate the native ID while leaving the canonical `sessionId` invariant.
- **Provider Process Environment Propagation (`D9`, `C7`):**
  - Inject trusted ambient execution context into provider child process spawn options:
    - `NEVO_SESSION_ID = session.sessionId`: canonical Nevo session UUID.
    - `NEVO_AGENT_PROVIDER = provider`: provider name (`claude`, `antigravity`, `codex`).
    - `NEVO_SPEC_ID = specId`: specification UUID (diagnostic).
    - `NEVO_TASK_ID = activeTaskId`: currently active task ID (diagnostic).
  - Concrete adapter integration sites:
    - In `tools/dashboard/server/ai/providers/claude/provider.mjs`: inject into `childEnv` in `#startTurnWithSession`.
    - In `tools/dashboard/server/ai/providers/antigravity/provider.mjs`: inject into `spawnEnv` in `startTurn`.
    - In `tools/dashboard/server/ai/providers/codex/app-server-client.mjs` and `provider.mjs`: pass ambient environment into client process / thread execution options.
- **Ambient Context Discovery & CLI Auto-Binding (`D9`):**
  - In `tools/specs.mjs`:
    - Update `autoBindAgentSession` to read `process.env.NEVO_SESSION_ID` and `process.env.NEVO_AGENT_PROVIDER` via `readAgentExecutionContext()`.
    - Call `bindingService.bindSessionSync` to record or update `SessionTaskBinding` with current `taskId`, `step`, and `attempt`.
    - Do not require the agent to supply or author session ID flags (`--session <id>` is forbidden). Session ID is never an agent-authored input or command parameter; it is exclusively resolved from trusted ambient runtime context.
  - In `tools/specs/workflow/cli.mjs`:
    - Ensure `handleWorkflowStepStart` and `handleWorkflowStepFinish` invoke `autoBindAgentSession`.
- **Session ↔ Task Historical Binding & Task Switching (`D2`, `C10`):**
  - In `tools/dashboard/server/ai/sessions/binding-service.mjs`:
    - Persist `SessionTaskBinding[]` per-spec in `.nevo-ai-local/sessions/<specId>.json`.
    - Distinguish `taskIds` (all associated tasks), `activeTaskId` (currently selected interaction context), and historical bindings.
    - Support updating `activeTaskId` explicitly without altering historical task records.
    - Implement `getTasksForSession(provider, providerSessionId, specId)` returning bound tasks sorted by `lastSeenAt` descending.
    - Implement `getSessionsForTask(specId, taskId)` returning all participating sessions.
- **First-Turn Context Injection & Clean Transcript Separation:**
  - In `tools/dashboard/server/ai/sessions/service.mjs`:
    - When starting turn 1 of an assigned task or after an explicit task switch:
      - Pre-pend the minimal hidden `[Nevo Workflow Context]` header (spec, task, step, attempt, workflow CLI instruction, and stop rule) to the provider prompt payload.
      - Keep `userMessage` clean (e.g. `"Implement task <id>: <title>"`) so chat transcripts render natural human dialogue.
      - Intermediate turns within the same active attempt do not repeat the full bootstrap header.
- **Workflow Server Endpoints & Available Actions Projection (`D3`, `D7`, `C9`):**
  - In `tools/dashboard/server/specs/routes.mjs` / `actions.mjs`:
    - Implement `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision`:
      - Accepts `{ decision: 'approve' | 'request-changes', feedback?: string }`.
      - Calls `finishStep(result: 'pass')` for `approve` (transitions to `verified`, executes clean-tree noop commit).
      - Calls `finishStep(result: 'fail')` for `request-changes` (transitions to `implementation` attempt N+1, records feedback in history).
    - Compute server-side `availableActions` projection on task and specification read models based on current `workflow_progress.state`, `step`, attempt, and history.

## Acceptance criteria

1. Synchronous canonical `sessionId` UUID is generated at session creation time and bound with `established: false` before any provider process is spawned. `automated: node --test tools/dashboard/tests/session-task-bootstrap.test.mjs`
2. Provider process spawn configurations across Claude, Antigravity, and Codex receive `NEVO_SESSION_ID` and `NEVO_AGENT_PROVIDER` in their ambient execution environments. `automated: node --test tools/dashboard/tests/session-task-bootstrap.test.mjs`
3. Running `workflow step start` inside an environment with `NEVO_SESSION_ID` automatically creates and persists a `SessionTaskBinding` with the correct task, step, and attempt without the model supplying any session ID. `automated: node --test tools/dashboard/tests/binding-service.test.mjs`
4. Calling `markSessionEstablished` when provider native session ID arrives updates `providerSessionId` and clears `established: false` without altering the canonical `sessionId` or breaking earlier bindings. `automated: node --test tools/dashboard/tests/session-task-bootstrap.test.mjs`
5. Multi-task sessions correctly maintain historical task bindings and allow explicit switching of `activeTaskId` without overwriting prior task history or guessing from chat text. `automated: node --test tools/dashboard/tests/binding-service.test.mjs`
6. First-turn prompt payload receives the `[Nevo Workflow Context]` header while `userMessage` remains clean in chat storage. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
7. `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` with `approve` executes clean-tree noop commit and transitions task to `verified`. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
8. `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` with `request-changes` requires feedback, transitions task to `implementation` attempt N+1, and records feedback in history. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
9. Task read models project `availableActions` matching the state-action matrix. `automated: node --test tools/dashboard/tests/specs-actions.test.mjs`
10. `node tools/specs.mjs check` passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/dashboard/tests/binding-service.test.mjs
node --test tools/dashboard/tests/session-task-bootstrap.test.mjs
node --test tools/dashboard/tests/ai-server.test.mjs
node --test tools/dashboard/tests/specs-actions.test.mjs
node tools/specs.mjs check
```

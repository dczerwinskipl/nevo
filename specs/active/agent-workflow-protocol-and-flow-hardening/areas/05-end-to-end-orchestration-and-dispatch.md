# Area: End-to-End Orchestration, Dispatch & Lifecycle Sequences

## Purpose

Define the concrete runtime path, application boundaries, and interaction sequences that connect the user's action in the dashboard to the agent's autonomous workflow execution, trusted identity propagation, and subsequent transition handling.

## End-to-End Runtime Architecture & Sequence

The deterministic workflow execution path flows through explicit application boundaries without manual prompt coaching:

```text
User
 ↓ (1. Clicks "[ Start implementation ]")
Dashboard Task Surface
 ↓ (2. Calls POST /api/specs/:slug/tasks/:taskId/workflow/start-work)
Specs Action Handler / AI Server
 ↓ (3. Resolves/creates session via AgentSessionService; allocates Nevo sessionId UUID)
AgentSessionService.startTurn(...)
 ↓ (4. Injects trusted NEVO_SESSION_ID into provider process env; injects hidden context block)
Provider CLI Process Spawned (Claude / Antigravity / Codex)
 ↓ (5. Receives enriched prompt: hidden <nevo-execution-context> + user message)
Agent Reads Context & Executes Tool
 ↓ (6. Runs: node tools/specs.mjs workflow step start <change> <task>)
Workflow CLI & autoBindAgentSession
 ↓ (7. Reads process.env.NEVO_SESSION_ID; creates/refreshes SessionTaskBinding)
StepContext Returned to Agent
 ↓ (8. Authoritative: currentStep, attempt, allowed_paths, finishContract)
Agent Performs Bounded Work
 ↓ (9. Modifies files strictly within allowed_paths)
Agent Calls Finish Tool
 ↓ (10. Runs: node tools/specs.mjs workflow step finish <change> <task> --input '{...}')
Workflow Engine Finish Operation
 ↓ (11. Evaluates gates, stages changes, commits, executes transition to 'review')
SessionTaskBinding Refreshed
 ↓ (12. Updates lastSeenAt, step, attempt)
Agent Autonomous STOP
 ↓ (13. Outputs completion summary; turn completes; no further tool calls)
Dashboard State Invalidation (SSE / Query Refetch)
 ↓ (14. Reloads task workflow_progress and availableActions projection)
Next Action Rendered Above Composer
   (15. Renders "Task 03 · Review ready" with "[ Start review ]")
```

## Concrete Boundaries for Every Arrow

1. **User Action:** The developer views the task card or chat header in the Nevo dashboard and clicks `[ Start implementation ]` (or `[ Start review ]`).
2. **Dashboard UI Mutation:** The UI calls `POST /api/specs/:slug/tasks/:taskId/workflow/start-work` with `{ sessionId?: string, provider?: string, model?: string }`.
3. **Server Session Coordination:**
   - The server handler in `tools/dashboard/server/specs/actions.mjs` checks the task's current workflow state.
   - If a `sessionId` is passed, it verifies compatibility; otherwise, it creates a new session via `AgentSessionService.createSession(...)`.
   - Nevo allocates a canonical `sessionId` (UUID) immediately.
4. **Hidden Context Enrichment & Trusted Env Injection:**
   - In `tools/dashboard/server/ai/sessions/service.mjs`, `startTurn` prepares the turn dispatch.
   - The provider process spawn environment (`childEnv` in Claude, `spawnEnv` in Antigravity/Codex) is injected with:
     - `NEVO_SESSION_ID = sessionId`
     - `NEVO_AGENT_PROVIDER = provider`
     - `NEVO_SPEC_ID = change.spec_id`
     - `NEVO_TASK_ID = task.id`
   - The prompt sent to the provider is enriched with the hidden bootstrap block:
     ```text
     <nevo-execution-context>
     specification: <changeSlug>
     task: <taskId>
     step: <currentStep>
     attempt: <currentAttempt>
     workflow_mode: deterministic
     instruction: Run 'node tools/specs.mjs workflow step start <changeSlug> <taskId>' to obtain authoritative StepContext. Work strictly within returned boundaries.
     </nevo-execution-context>

     Implement task <taskId>
     ```
   - The user-visible message remains clean: `"Implement task <taskId>"`.
5. **Provider Process Execution:** The provider executable (e.g. `claude`, `antigravity`, `codex`) launches with the injected environment variables.
6. **Agent CLI Tool Call:** The model reads the instruction in the system/user context and issues a tool call:
   `node tools/specs.mjs workflow step start <changeSlug> <taskId>`
7. **Ambient Identity Capture & Binding:**
   - `tools/specs.mjs`'s `autoBindAgentSession` reads `process.env.NEVO_SESSION_ID` and `process.env.NEVO_AGENT_PROVIDER`.
   - It writes/updates `.nevo-ai-local/sessions/<specId>.json` via `AgentSessionBindingService`, creating a `SessionTaskBinding` with `(sessionId, specId, taskId, step, attempt)`.
8. **StepContext Generation:** `compileStepContext` activates the attempt, validates clean baseline, derives `finishContract`, gates, and `previousTransition`, and prints authoritative JSON.
9. **Agent Implementation:** The agent writes code and tests strictly within `allowed_paths`.
10. **Agent Finish Call:** The agent constructs the JSON payload based on `finishContract.parameters` and calls:
    `node tools/specs.mjs workflow step finish <changeSlug> <taskId> --input '{"commit.title":"feat: implement task 03"}'`
11. **Workflow Engine Finalize & Transition:**
    - `finishStep` in `finish-operation.mjs` verifies gates, stages changes (`include: ['*']`), commits to Git, atomically records the completion in `change.yaml`'s `workflow_progress.history`, and computes the next step (`review`).
12. **Binding Refresh:** `handleWorkflowStepFinish` updates the binding's `lastSeenAt` and step in `.nevo-ai-local/sessions/<specId>.json`.
13. **Agent Autonomous Stop:** The agent sees `status: 'completed'`, outputs a user-facing summary, and finishes its turn.
14. **Dashboard State Invalidation:** The web UI receives the `turn.completed` event via SSE, invalidates React Query caches for specifications and tasks, and refetches the latest authoritative state.
15. **Next Action Rendered:** The UI observes that the task is in `step: 'review'`, `state: 'active'`. It renders `Task 03 · Review ready` and displays the `[ Start review ]` action button.

## First-Turn Session ID Timing Resolution

When a new session is created on a provider where `createSession` does not pre-allocate a native provider conversation ID (e.g. Antigravity or Codex):
1. **Authoritative Nevo Session ID:** Nevo dashboard server generates a canonical `sessionId` (UUID) at session creation time.
2. **Immediate Binding with Placeholder Identity:** `AgentSessionBindingService.bindSession` registers this `sessionId` with `established: false`.
3. **Environment Propagation:** `NEVO_SESSION_ID` is set to this UUID in the process environment.
4. **Early CLI Calls:** If the agent executes `workflow step start` immediately on turn 1, the CLI auto-binds using this stable `NEVO_SESSION_ID`.
5. **Provider Confirmation Reconciliation:** When the provider establishes the conversation and fires `onSessionEstablished(allocatedProviderSessionId)`, `bindingService.markSessionEstablished` associates the provider's native ID with the existing binding record without breaking earlier linkages.

## Prompt Context Enrichment Lifecycle

Context enrichment is applied deterministically by `AgentSessionService` whenever a turn is initiated for a task:
- **Initial Turn:** Injects the full `<nevo-execution-context>` block alongside the task intent.
- **Subsequent Turns on Active Attempt:** If the user sends a follow-up message during the same attempt, context enrichment is refreshed with current status to remind the agent of its bounded step.
- **Next Step Dispatch:** When the user initiates a new step (e.g. `[ Start review ]`), a fresh bootstrap block is generated with `step: review`, instructing the agent to run `workflow step start` for the review step.
- **User Visibility Invariant:** Enriched headers are sent exclusively to the provider runtime. They are never rendered in chat message bubbles or saved as fake user transcript entries.

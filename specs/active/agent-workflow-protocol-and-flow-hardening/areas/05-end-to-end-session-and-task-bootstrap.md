# Area 05: End-to-End Session and Task Bootstrap

## Purpose

Define the complete, unambiguous runtime execution lifecycle from the moment an operator selects a task in the Nevo dashboard through agent process spawning, trusted execution identity propagation, CLI auto-binding, step execution, review, human verification, rejection/retry loops, and final verification. This area bridges the user interface, session management runtime, provider child-process adapters, and the deterministic workflow engine into an unbroken, auditable pipeline.

---

## 1. End-to-End Execution Sequence

The standard happy-path and rejection-loop lifecycle spans six distinct phases across five architectural boundaries:

```text
Dashboard UI                Server Session API             Provider Process              Workflow CLI             Engine / Git
     │                              │                             │                           │                        │
     ├─ 1. Select task 03 ─────────►│                             │                           │                        │
     │     provider=Claude          │                             │                           │                        │
     ├─ 2. POST /api/agent-sessions►│                             │                           │                        │
     │                              ├─ 3. createSession()         │                           │                        │
     │                              │     allocate sessionId UUID │                           │                        │
     │                              │     bindSession(prov, id)   │                           │                        │
     │◄─ 4. return { session } ─────┤                             │                           │                        │
     ├─ 5. queueInitialDispatch()   │                             │                           │                        │
     ├─ 6. Navigate to chat view    │                             │                           │                        │
     ├─ 7. POST .../turns ─────────►│                             │                           │                        │
     │     (message, userMessage)   ├─ 8. startTurn()             │                           │                        │
     │                              │     spawn process with      │                           │                        │
     │                              │     NEVO_SESSION_ID env ───►│                           │                        │
     │                              │                             ├─ 9. Agent turn starts     │                        │
     │                              │                             │     receives prompt + ctx │                        │
     │                              │                             ├─ 10. step start ─────────►│                        │
     │                              │                             │                           ├─ 11. autoBind reads env│
     │                              │◄────────────────────────────┼───────────────────────────┼─ bindSessionSync()     │
     │                              │                             │◄─ 12. return StepContext ─┤                        │
     │                              │                             ├─ 13. Implement changes    │                        │
     │                              │                             ├─ 14. step finish ────────►│                        │
     │                              │                             │                           ├─ 15. Commit/tag branch │
     │                              │                             │                           ├─ 16. Advance state:    │
     │                              │                             │                           │      in-review         │
     │                              │                             │◄─ 17. Exit 0 ─────────────┤                        │
     │                              │                             ├─ 18. Agent STOPs          │                        │
     │◄─ 19. SSE: turn finished ────┤                             │                           │                        │
     │   Task status: in-review     │                             │                           │                        │
     │   Action: [ Start review ]   │                             │                           │                        │
```

### Phase-by-Phase Trace

#### Phase A: Task Initiation and Session Bootstrap
1. **Operator Intent:** The operator views specification `X` on the Nevo dashboard. Tasks `01` and `02` are verified; Task `03` is pending in `todo` status. The task card displays `[ Start implementation ]`.
2. **Session Creation:** The dashboard invokes the existing session endpoint:
   `POST /api/agent-sessions` with payload:
   ```json
   {
     "specId": "3aa4f1ac-0daf-4906-8275-9a9d9c84c3cd",
     "taskId": "03",
     "taskIds": ["03"],
     "provider": "claude",
     "mode": "edit",
     "purpose": "task:03"
   }
   ```
3. **Server Session & Identity Allocation:** `AgentSessionService.createSession` synchronously generates a canonical Nevo `sessionId` UUID (e.g. `d3b07384-789a-4c42-8813-fa6e2820a1bc`).
   - For Claude: `providerSessionId` is initialized as a local placeholder UUID with `established: false`.
   - For Codex: `app-server` allocates a thread ID immediately (`established: true`).
   - `AgentSessionBindingService.bindSession` writes an initial binding entry to `.nevo-ai-local/sessions/<specId>.json` recording `sessionId`, `provider`, `providerSessionId`, `specId`, `taskId: '03'`, and `established`.
4. **Client Navigation & Prompt Enqueueing:** The server returns `{ session }`. The dashboard calls `queueAgentSessionInitialDispatch`:
   - `userMessage`: `"Implement task 03: <title>"` (visible in chat transcript bubbles).
   - `prompt`: Injected hidden protocol header (see Section 4) concatenated with task requirements.
   - Dashboard navigates to `/specs/active/<slug>/sessions/<provider>/<providerSessionId>`.

#### Phase B: Ambient Environment Injection & Turn Execution
5. **Turn Dispatch:** The session screen mounts, reads `pendingDispatchStore`, and sends:
   `POST /api/agent-sessions/:provider/:providerSessionId/turns` with `{ message: prompt, userMessage }`.
6. **Ambient Process Environment Injection:** `AgentSessionService.startTurn` passes trusted execution context into the provider's child process spawn options:
   - `NEVO_SESSION_ID`: The canonical Nevo session UUID.
   - `NEVO_AGENT_PROVIDER`: The provider name (e.g. `'claude'`).
   - `NEVO_SPEC_ID`: The specification UUID.
   - `NEVO_TASK_ID`: The current selected task ID (`'03'`).
   *(See Section 3 for provider adapter spawn integration).*
7. **Agent Turn Startup:** The agent process starts. The model sees the prompt and protocol header directing it to begin by invoking the workflow CLI.

#### Phase C: Deterministic Step Start & Auto-Binding
8. **CLI Invocation:** The agent runs:
   ```bash
   node tools/specs.mjs workflow step start agent-workflow-protocol-and-flow-hardening 03
   ```
9. **Zero-Guess Discovery & Auto-Binding:** `tools/specs.mjs` executes `autoBindAgentSession`. `readAgentExecutionContext` extracts `NEVO_SESSION_ID` and `NEVO_AGENT_PROVIDER` from `process.env`.
   - `autoBindAgentSession` calls `bindingService.bindSessionSync`, recording `taskId: '03'`, `step: 'implementation'`, and `attempt: 1` on the binding record.
   - The agent does not need to author, inspect, or pass any session flags.
10. **Authoritative StepContext:** The CLI executes `allocateAttempt` or `resolveActiveAttempt`, validates git clean baselines, compiles `StepContext`, and outputs it as JSON/YAML. The agent treats `StepContext` as authoritative for `allowed_paths`, `forbidden_paths`, and exit criteria.
11. **Provider Session Confirmation:** When Claude outputs its first streaming event or turn completion, `setProviderSessionId(allocatedId)` triggers `bindingService.markSessionEstablished`. The native provider ID is linked without mutating the canonical `sessionId`.

#### Phase D: Implementation Finish & Handover to Review
12. **Work Execution:** The agent implements code, runs tests, and verifies changes within `allowed_paths`.
13. **Step Finish:** The agent runs:
    ```bash
    node tools/specs.mjs workflow step finish agent-workflow-protocol-and-flow-hardening 03 --result success
    ```
14. **Git Hardening & Transition:**
    - Workflow engine verifies git status: modified files match `allowed_paths`, forbidden paths untouched.
    - Finalize action `commit-and-push` commits changes with standardized message: `feat(agent-workflow-protocol-and-flow-hardening): implement task 03 (attempt 1)`.
    - Git tag `nevo/agent-workflow-protocol-and-flow-hardening/03/implementation/attempt-1` is created.
    - Task status in `change.yaml` transitions to `in-review`.
    - Working tree postcondition: clean.
15. **Agent Stops:** The CLI exits with code 0. Following the protocol instruction, the agent issues a brief summary and **stops**. No autonomous turn or handover is attempted.

#### Phase E: Review Initiation & Rejection
16. **UI State Projection:** The turn ends. The dashboard receives the updated manifest:
    - Task 03 status: `in-review`.
    - Current step: `review`.
    - `availableActions: ['start-review']`.
    - Task card and in-chat workflow bar render `[ Start review ]`.
17. **Reviewer Startup:** Operator clicks `[ Start review ]`. The operator chooses provider (e.g. Codex or Claude) or reuses the existing conversation.
    - If new session: dashboard calls `POST /api/agent-sessions` with `taskId: '03'`, `purpose: 'workflow:review:03'`.
    - Turn is dispatched with review prompt and `[Nevo Workflow Context]` header.
18. **Review Step Start:** Reviewer runs `node tools/specs.mjs workflow step start <slug> 03`.
    - CLI auto-binds review session using ambient `NEVO_SESSION_ID`.
    - Workflow engine checks `change.yaml`: current step is `review`, attempt 1.
    - CLI returns `StepContext` for `step: 'review'`, specifying review guidelines and read-only / test execution scope.
19. **Review Evaluation & Findings:** Reviewer runs tests, discovers a flaw, and writes findings to `specs/active/<slug>/reviews/task-03-attempt-1.md`.
20. **Review Finish with Rejection:** Reviewer runs:
    ```bash
    node tools/specs.mjs workflow step finish <slug> 03 --result needs-changes --feedback "Unit tests fail in auth middleware boundary." --artifacts specs/active/<slug>/reviews/task-03-attempt-1.md
    ```
21. **Transition to Human Verification:**
    - CLI verifies commit HEAD matches implementation commit (reviewer did not author illegitimate code edits).
    - `standard.yaml` routing rule transitions task to `awaiting-human-verification` with `humanDecisionRequired: true`.
    - Review findings and feedback are appended to `workflow_progress.history`.
    - Reviewer agent stops.

#### Phase F: Human Decision & Attempt 2 Loop
22. **Human Verification Without Agent:**
    - Task 03 status: `awaiting-human-verification`.
    - No AI turn is running.
    - Dashboard renders workflow action surface above composer: `Task 03 · Human verification · Attempt 1` with buttons `[ Request changes ]` and `[ Approve ]`.
23. **Operator Rejection:** Operator clicks `[ Request changes ]`.
    - Composer switches into `request-changes` mode with prominent banner and placeholder: `"Provide specific feedback and required corrections for attempt 2..."`.
    - Operator enters rationale: `"Fix error handling in middleware edge case."` and clicks `[ Send & reject ]`.
24. **Backend Human Decision Transition:**
    - Client sends `POST /api/specs/:slug/tasks/03/workflow/human-decision` with `{ decision: 'request-changes', feedback: '...' }`.
    - Server invokes `handleWorkflowVerifyHuman` / `finishStep` with `result: 'fail'`.
    - Engine records human rejection in history, resets step to `implementation`, and increments to attempt 2.
    - UI receives update: Task 03 status is `in-implementation` (attempt 2), `availableActions: ['start-implementation']`.
25. **Attempt 2 Initiation:** Operator clicks `[ Start implementation ]` (reusing conversation or opening fresh session).
    - Turn starts with enriched prompt.
    - Agent runs `node tools/specs.mjs workflow step start <slug> 03`.
    - Engine compiles `StepContext` for attempt 2, containing `previousTransition`:
      ```yaml
      previousTransition:
        from: human-verification
        attempt: 1
        result: fail
        requestedChanges: "Fix error handling in middleware edge case."
        reviewFeedback: "Unit tests fail in auth middleware boundary."
        reviewArtifacts:
          - specs/active/agent-workflow-protocol-and-flow-hardening/reviews/task-03-attempt-1.md
      ```
26. **Resolution & Approval:**
    - Agent fixes the issue and calls `step finish --result success`.
    - Reviewer runs review attempt 2, tests pass, calls `step finish --result success`.
    - Task transitions to `awaiting-human-verification`.
    - Operator clicks `[ Approve ]`.
    - Server transitions task to `verified`.
    - Task 03 is complete. If Task 04 exists and was blocked by 03, Task 04 becomes unblocked and ready for work.

---

## 2. Canonical Entry Point for Starting Task Work

Rather than inventing a redundant parallel orchestration API, task initiation reuses Nevo's existing, proven `AgentSession` application infrastructure:

### Dashboard Initiation Contract

When the operator clicks `[ Start implementation ]` or `[ Start review ]`:
1. **Session Resolution or Creation:**
   The dashboard calls `POST /api/agent-sessions`:
   ```typescript
   interface CreateSessionRequest {
     specId: string;       // Canonical UUID
     taskId: string;       // Primary task ID, e.g. "03"
     taskIds?: string[];   // Associated tasks, e.g. ["03"]
     provider: string;     // "claude" | "codex" | "antigravity"
     mode?: 'edit' | 'ask' | 'agent';
     model?: string;
     purpose?: string;     // "task:03" | "workflow:review:03"
   }
   ```
2. **Initial Turn Queueing:**
   The dashboard invokes `queueAgentSessionInitialDispatch`:
   - `provider`: `session.provider`
   - `providerSessionId`: `session.providerSessionId`
   - `userMessage`: Clean text (e.g. `"Implement task 03: Chat surface workflow actions"`)
   - `prompt`: Concatenation of the hidden protocol header + user message
3. **Navigation:**
   The dashboard navigates to `/specs/$source/$slug/sessions/$provider/$providerSessionId`.
4. **Immediate Turn Dispatch:**
   `AgentSessionScreen` mounts, retrieves the pending dispatch from `pendingDispatchStore`, and dispatches `POST /api/agent-sessions/:provider/:providerSessionId/turns`.
5. **Headless / Automated Execution Alternative:**
   For CLI automation and E2E testing, callers may invoke `POST /api/agent-sessions/turns` directly to atomically create the session and start turn 1 in a single HTTP request.

---

## 3. Trusted Session Execution Identity Model

### The First-Turn Timing Problem
In providers like Claude CLI, native conversation sessions are allocated lazily upon streaming output or turn completion (`setProviderSessionId`). When an agent executes `node tools/specs.mjs workflow step start` on turn 1 tool 1, no native `providerSessionId` exists yet.

### The Solution: Canonical Nevo Session Identity (`D9`)
1. **Synchronous Allocation:** `AgentSessionService.createSession` generates an authoritative, canonical `sessionId` UUID at session creation time, before any child process is spawned.
2. **Ambient Inheritance:** The server passes `NEVO_SESSION_ID` into the provider process environment.
3. **CLI Discovery:** `tools/specs.mjs` extracts `process.env.NEVO_SESSION_ID` and `process.env.NEVO_AGENT_PROVIDER` to record `SessionTaskBinding` immediately upon step start.
4. **Native Correlation:** When the provider subsequently materializes its internal conversation ID, `bindingService.markSessionEstablished(provider, allocatedId)` correlates the native ID to the existing binding without changing `sessionId`.

```text
Nevo Dashboard Server
    │
    ├─ 1. createSession() allocates canonical sessionId: "d3b07384-..."
    ├─ 2. bindSession({ sessionId, established: false, ... })
    ├─ 3. spawn provider CLI with env.NEVO_SESSION_ID = "d3b07384-..."
    │
Provider Child Process (e.g. Claude / Codex / AGY)
    │
    ├─ 4. Agent runs: node tools/specs.mjs workflow step start ...
    │     autoBindAgentSession reads process.env.NEVO_SESSION_ID
    │     binds step/attempt to "d3b07384-..." (established: false)
    │
Provider Native Conversation Materialized
    │
    └─ 5. setProviderSessionId("claude-conv-9876")
          bindingService.markSessionEstablished durably correlates
          providerSessionId = "claude-conv-9876", established = true
          Canonical sessionId "d3b07384-..." remains unchanged.
```

---

## 4. Provider Process Environment Injection Sites

To ensure ambient context propagates transparently without provider-specific protocol drift, all provider adapters inject trusted context into their process spawn configurations:

### 1. Claude Provider (`tools/dashboard/server/ai/providers/claude/provider.mjs`)
In `#startTurnWithSession`:
```javascript
const childEnv = {
  ...process.env,
  CLAUDE_INTERACTIVE: '0',
  NEVO_SESSION_ID: session.sessionId || effectiveSessionId,
  NEVO_AGENT_PROVIDER: 'claude',
  NEVO_SPEC_ID: params.specId,
  NEVO_TASK_ID: params.taskId,
};
```

### 2. Antigravity Provider (`tools/dashboard/server/ai/providers/antigravity/provider.mjs`)
In `startTurn`:
```javascript
const spawnEnv = {
  ...process.env,
  AGY_INTERACTIVE: '0',
  FORCE_COLOR: '0',
  NEVO_SESSION_ID: session.sessionId || providerSessionId,
  NEVO_AGENT_PROVIDER: 'antigravity',
  NEVO_SPEC_ID: params.specId,
  NEVO_TASK_ID: params.taskId,
  ...(mcpToken ? { NEVO_INTERACTION_TOKEN: mcpToken } : {}),
  NEVO_MCP_ENDPOINT: effectiveMcpEndpoint,
};
```

### 3. Codex App-Server Client (`tools/dashboard/server/ai/providers/codex/app-server-client.mjs` & `provider.mjs`)
The `CodexAppServerClient` receives ambient environment variables in its spawn options. Individual command execution or session contexts pass `NEVO_SESSION_ID`, `NEVO_AGENT_PROVIDER`, `NEVO_SPEC_ID`, and `NEVO_TASK_ID` in the execution environment.

---

## 5. First-Turn Injected Context vs Clean Transcript

To protect developer experience and prevent prompt pollution:
- **Clean Chat Bubble (`userMessage`):** The visible transcript displays only what the user entered or authorized (e.g. `"Implement task 03: Chat surface workflow actions"`).
- **Hidden Execution Context Header:** Pre-pended to the prompt payload sent to the LLM on the first turn of an attempt or upon an explicit task switch:

```text
[Nevo Workflow Context]
Specification: agent-workflow-protocol-and-flow-hardening
Task: 03
Step: implementation (attempt 1)

You are executing a deterministic Nevo workflow task.
Before modifying any files or running tests, you MUST start your step:
  node tools/specs.mjs workflow step start agent-workflow-protocol-and-flow-hardening 03

The JSON/YAML output returned by that command contains your authoritative StepContext:
- allowed_paths: paths you may create or modify
- forbidden_paths: paths you must not touch
- verification: automated test commands you must pass
- previousTransition: feedback from earlier attempts (if any)

Rules:
1. Do not manually edit change.yaml or manifest files.
2. Do not run manual git commit, git push, or git tag commands.
3. When implementation and verification are complete, run:
   node tools/specs.mjs workflow step finish agent-workflow-protocol-and-flow-hardening 03 --result success
4. After successful step finish, summarize your work and STOP.
```

### Injection Frequency Rules
- Injected on the **first turn** when a session is assigned to a task.
- Injected when the operator explicitly switches the active task in a multi-task session.
- Injected on the first turn of a new attempt (e.g. Attempt 2 after human changes requested).
- **Not injected** on intermediate conversational turns within the same active attempt (e.g. user answering an agent's question or providing clarification).

---

## 6. Multi-Task Sessions and Explicit Task Switching

A single developer session often spans multiple tasks over its lifecycle. The runtime enforces clear boundaries between association, execution context, and state machine attempts:

### Semantic Distinctions
1. **Associated Tasks (`taskIds`):** Tasks visible to or associated with the session. Displayed as chips/pills in the session workflow bar.
2. **Active Interaction Task (`activeTaskId`):** Exactly one task selected by the operator as the current focus of the chat session.
3. **Active Workflow Attempt:** The single step/attempt currently recorded in `change.yaml` for that task.

### Execution Rule: Strict Singularity
Agent workflow execution is strictly:
> **One task, one step, one attempt at a time.**

Even if `taskIds` contains `['01', '02', '03']`, the session executes only the `activeTaskId`. Concurrent multi-task execution within a single session is forbidden.

### Explicit Task Switching Lifecycle
1. Task `03` completes its implementation step.
2. Operator wants to work on Task `04` in the same conversation.
3. Operator clicks Task `04` in the chat workflow bar.
4. UI updates `activeTaskId = '04'`.
5. Next user turn dispatches with the Task `04` workflow header.
6. Agent runs `node tools/specs.mjs workflow step start <slug> 04`.
7. `autoBindAgentSession` records a new `SessionTaskBinding` for Task `04`. Historical bindings for Task `03` are preserved intact.
8. Free-form chat text **never** causes automatic task switching.

---

## 7. Review Session Bootstrap and Findings Durability

1. **Decoupled Reviewer Choice:** Review may be executed in the original session, or the operator may start a fresh session with a different model/provider (e.g. Codex or Claude Haiku).
2. **Automatic Step Resolution:** When the reviewer runs `workflow step start <slug> 03`, the workflow engine inspects `change.yaml`. Because the task is in `in-review`, the engine resolves `step: 'review'`, `attempt: 1` automatically.
3. **Evidence Durability (`D6`):**
   - If review fails, findings are written to a markdown artifact: `specs/active/<slug>/reviews/task-03-attempt-1.md`.
   - The reviewer finishes with:
     ```bash
     node tools/specs.mjs workflow step finish <slug> 03 --result needs-changes --feedback "..." --artifacts "..."
     ```
   - The engine copies feedback and artifact links into `workflow_progress.history`. When implementation attempt 2 starts, `compileStepContext` projects these findings into `previousTransition`.

---

## 8. Human Decision Lifecycle Without an Agent

1. When review passes, or when review fails and flags `humanDecisionRequired: true`, the task enters `awaiting-human-verification`.
2. **No Active AI Turn:** At this boundary, no agent is executing. The dashboard derives actionable state directly from the authoritative manifest and projects `availableActions: ['approve', 'request-changes']`.
3. **Direct Application Execution (`D7`):**
   - `[ Approve ]`: Dispatches `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` with `{ decision: 'approve' }`. Server executes `finishStep(result: 'pass')` -> transitions to `verified`.
   - `[ Request changes ]`: Switches composer to `request-changes` mode. Operator enters typed rationale. Submitting sends `POST .../human-decision` with `{ decision: 'request-changes', feedback: '...' }`. Server executes `finishStep(result: 'fail')` -> transitions to `implementation` attempt N+1.
4. **Clean-Tree Invariant:** Human decisions do not author code changes. If the working tree is clean, the finalize engine skips git commit creation (noop commit) while recording the audit tag and history entry.

---

## 9. Application-Level 18-Step Bootstrap Acceptance Scenario

To ensure end-to-end correctness across all layers, Task 03 includes an automated E2E test in `tools/dashboard/tests/e2e-product-workflow.test.mjs` verifying this exact sequence:

1. **Create Session:** Server creates session for spec `test-spec`, task `01`.
2. **Trusted Identity:** Verify `sessionId` UUID is generated and binding exists with `established: false`.
3. **Context Injection:** Dispatch turn 1; verify provider spawn environment receives `NEVO_SESSION_ID`. Verify prompt receives `[Nevo Workflow Context]` and transcript receives clean `userMessage`.
4. **Step Start Auto-Binding:** Simulated agent executes `workflow step start test-spec 01`. Verify `SessionTaskBinding` updates with `step: 'implementation'`, `attempt: 1`.
5. **Session Established Correlation:** Trigger `onSessionEstablished('provider-native-123')`; verify `providerSessionId` updates and `established` becomes `true` while `sessionId` remains invariant.
6. **Implementation Finish:** Agent calls `workflow step finish test-spec 01 --result success`. Verify git branch committed, tagged, and manifest status is `in-review`.
7. **Agent Stops:** Verify turn concludes and agent process exits.
8. **Review Initiation:** Dispatch review turn for task `01` (new session). Verify environment receives new `NEVO_SESSION_ID` with same `NEVO_TASK_ID: '01'`.
9. **Review Step Start:** Reviewer runs `workflow step start test-spec 01`. Verify engine returns StepContext for `step: 'review'`, `attempt: 1`.
10. **Review Rejection:** Reviewer writes review artifact and calls `workflow step finish test-spec 01 --result needs-changes --feedback 'Unit tests failed'`.
11. **Human Verification Transition:** Verify commit HEAD matches implementation commit and task transitions to `awaiting-human-verification`.
12. **Human Request Changes:** Dispatch `POST .../human-decision` with `{ decision: 'request-changes', feedback: 'Fix edge cases' }`. Verify task transitions to `in-implementation` attempt 2.
13. **Implementation Attempt 2 Start:** Agent runs `workflow step start test-spec 01`. Verify returned `StepContext.previousTransition` contains human feedback and review artifact path.
14. **Implementation 2 Finish:** Agent completes fix and calls `workflow step finish --result success`. Task advances to `in-review` attempt 2.
15. **Review 2 Pass:** Reviewer runs `workflow step finish --result success`. Task advances to `awaiting-human-verification`.
16. **Human Approval:** Dispatch `POST .../human-decision` with `{ decision: 'approve' }`. Verify task transitions to `verified`.
17. **Git Workspace Purity:** Verify repository status is clean, with tags for attempt 1 and attempt 2.
18. **Session History Auditing:** Query `AgentSessionBindingService.listSessionsForTask('01')`. Verify all participating implementation and review sessions are listed with accurate step and attempt attribution.

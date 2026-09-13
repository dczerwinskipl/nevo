---
id: spec.agent-workflow-protocol-and-flow-hardening
type: change
title: "Agent workflow protocol and flow hardening"
status: draft
change: agent-workflow-protocol-and-flow-hardening
---

# Agent workflow protocol and flow hardening

## Context

PR #48 delivered the core deterministic workflow engine (`workflow step start`, `workflow step finish`, attempt lifecycle, result-driven transitions, durable finish operations, and attempt-scoped storage). That foundation established the mechanics needed to run multi-step review loops and verify-human operations.

However, several critical integration and product gaps remain before Nevo can run real specifications autonomously through its deterministic workflow:

1. **Missing Provider-Neutral Agent Protocol:** Agents have no authoritative, single-source instruction protocol teaching them how to drive `workflow step start` and `workflow step finish`. Without this, agents must be coached turn-by-turn with manual prompts ("now run start", "now call finish", "now do review"), which only tests the engine rather than testing Nevo.
2. **Brittle Git Finalize Semantics:** Git finalize in standard workflows previously required agents to manually enumerate modified files in an `include` parameter. A forgotten file contaminated subsequent steps, and clean trees (e.g. review without code edits or human signoff) crashed with `EMPTY_FILE_SELECTION`. Furthermore, dirty working trees could leak between new attempts.
3. **Inflexible Human Verification & Lost Feedback:** Human verification was modeled as an exit gate waiting for an agent to run finish and fabricate a commit. It lacked support for "Request Changes" with structured feedback. Rejections had no durable representation, meaning the next implementation attempt (attempt N+1) had no deterministic way to know what the user requested.
4. **Disjointed Chat Experience & Unclear Next Actions:** Developers were forced to switch out of the chat conversation or execute raw CLI commands to approve or reject work, and had no clear dashboard actions to trigger the next step after a transition completed.
5. **Rigid 1:1 Session Assumptions & Untrusted Identity:** The system lacked a many-to-many historical binding between chat conversations and workflow tasks, and lacked trusted runtime identity propagation from Nevo sessions to agent CLI processes, especially on turn 1 of newly created sessions.

This specification provides the final integration layer: an authoritative provider-neutral agent workflow protocol, hardened Git finalize invariants, a first-class human verification decision step with "Request Changes" loop transitions and durable feedback persistence, session ↔ task historical bindings, trusted execution identity propagation, clear post-transition dashboard actions, and in-chat workflow action controls.

## Goal

1. **One Authoritative Provider-Neutral Protocol:** Define a single vendor-neutral protocol in `docs/development/agent-workflow-protocol.md` (referenced in `AGENTS.md` and `CLAUDE.md`) and deliver all execution constraints through `StepContext`, allowing any agent (Claude, Antigravity, Codex, Cursor) to execute deterministic steps autonomously without manual coaching.
2. **Hardened Git Finalize & Clean Workspace Invariants:**
   - Enforce a strictly clean working tree before allocating any NEW attempt (`ensureStepActivated`), while allowing work-in-progress edits when resuming an already-active attempt.
   - Establish whole-attempt workspace ownership for standard deterministic workflows, defaulting `include` to attempt-scoped changes.
   - Support graceful zero-modification noop commits on clean working trees (e.g. for review pass or human approval).
   - Verify working tree cleanliness post-finish.
3. **First-Class Human Verification Decision Step with Request Changes:**
   - Update standard workflow definitions so `human-verification` branches to `pass -> verified` (Approve) and `fail -> implementation` (Request Changes).
   - Allow direct execution via CLI (`workflow verify-human --approve` / `--request-changes --feedback "..."`) or dashboard API without requiring agent post-processing or empty Git commits.
4. **Durable Feedback & Review Evidence Across Loops:**
   - Persist human feedback and review findings in `workflow_progress.history` and attempt-scoped storage.
   - Enrich the next attempt's `StepContext` with `previousTransition: { from, result, requestedChanges, artifacts }`.
5. **Many-to-Many Historical Session ↔ Task Binding:**
   - Persist `SessionTaskBinding` records in `.nevo-ai-local/sessions/<specId>.json` without committing session IDs to Git or requiring agent self-identification.
   - Automatically bind sessions during `workflow step start` and `workflow step finish` using ambient process environment (`NEVO_SESSION_ID`, `NEVO_AGENT_PROVIDER`).
6. **Trusted Execution Identity & First-Turn Resolution:**
   - Allocate a canonical `sessionId` UUID at session creation time, propagate it through provider child process environments, and reconcile with native provider conversation IDs asynchronously via `onSessionEstablished`.
7. **In-Chat Workflow Action Surface & Composer Modes:**
   - Display a compact tasks context bar and action surface immediately above the chat composer for actionable tasks.
   - Support a dedicated "Request Changes" composer mode that captures feedback and dispatches explicit deterministic workflow transitions.
   - Provide an operator-driven initiation model (`[ Start implementation ]`, `[ Start review ]`) with hidden prompt context enrichment.
   - Maintain a strict application boundary where the UI issues intent commands and the authoritative backend engine handles all transitions.

## Non-goals

- **Automatic Agent-to-Agent Handover:** Automatically launching or resuming subsequent provider sessions in the background is explicitly deferred. Transitions to agent-owned steps require explicit operator initiation.
- **Provider / Model Routing Selection:** Provider selection and model tier routing remain in the AI adapter layer.
- **Session Lineage Beyond Minimal Binding:** Parent/child session hierarchy and cross-session lineage tracking beyond `SessionTaskBinding` are deferred.
- **General Event Sourcing / SQLite Database:** No database introduction or general event-sourcing timeline; the next specification (`spec-history-and-timeline`) will introduce the append-only audit/timeline system.
- **Natural Language Parsing as Workflow Authority:** No NLP extraction to infer workflow routing from conversational chat messages; routing decisions remain explicit.
- **Mass-Reject / Bulk Operations:** Batch approval or multi-task rejection is deferred.
- **Dashboard UI Redesign / TypeScript Rewrite:** No general redesign or repository refactoring.

## Classification

| Signal | Rating | Reason |
|---|---|---|
| Behavioral clarity | GREEN | The protocol lifecycle, Git clean-baseline rules, human verification branching, feedback persistence, identity propagation, and binding model are precisely bounded and specified. |
| Public surface impact | YELLOW | Extends `StepContext` with `previousTransition`, updates `workflow verify-human` CLI flags, and introduces dashboard server endpoints; core CLI transport (`--input`) remains unchanged. |
| Package boundary impact | GREEN | Changes are cleanly isolated across repository tools (`tools/specs/workflow/`, `tools/dashboard/server/`, `tools/dashboard/ui/`). |
| Blast radius | YELLOW | Touches workflow CLI, standard workflow template, and dashboard session binding, but maintains strict backward compatibility for legacy workflows. |
| Reversibility | GREEN | Local runtime state only; opt-in via `workflow: { mode: deterministic }`. |

**Classification: T — Standard.** (Integration layer and flow hardening across existing boundaries; no new packages or database dependencies).

## Constraints

- **C1.** Single Source of Truth for Agent Protocol: The agent workflow protocol must be vendor-neutral, documented once in `docs/development/agent-workflow-protocol.md`, and reflected authoritatively in `StepContext`. No tool-specific lifecycle implementations.
- **C2.** Clean Workspace Baseline on New Attempts: Allocating a new attempt (`ensureStepActivated` from `new` or `completed`) requires a clean working tree. Resuming an active attempt must permit existing work in progress.
- **C3.** Whole-Attempt Workspace Ownership: Standard workflows must own the entire attempt workspace once a clean baseline is established. Agents must not be required to manually enumerate individual files in `include`.
- **C4.** Graceful Zero-Modification Commits: If a step finishes with zero file modifications (clean working tree), finalize must not throw `EMPTY_FILE_SELECTION`; it must record a clean noop commit.
- **C5.** Dual-Action Human Verification Step: `human-verification` is a first-class decision step branching to `pass -> verified` and `fail -> implementation`. The human action directly executes the finish operation without agent mediation.
- **C6.** Authoritative Feedback & Review Evidence Delivery: Human rejection feedback and review findings must survive transitions, be persisted in task history, and be projected into `StepContext.previousTransition` on attempt N+1.
- **C7.** Privacy & Git Invariants for Session Bindings: Session ↔ task bindings must live exclusively in `.nevo-ai-local/sessions/<specId>.json`. No session IDs committed to Git, no database requirement, no agent self-awareness required.
- **C8.** Explicit Routing Intent: Workflow actions triggered from the chat surface must carry explicit metadata (task ID, decision, feedback). AI/NLP must never infer transitions from free-form chat.
- **C9.** Strict Application Boundary: The UI must never mutate `change.yaml`, synthesize attempts, or evaluate transition graphs directly. All mutations occur through backend application endpoints delegating to the workflow engine.
- **C10.** Explicit Active Task in Multi-Task Sessions: A chat session may be historically bound to multiple tasks, but exactly one `activeTaskId` is designated for active workflow execution and action rendering at any time.
- **C11.** Operator-Driven Step Initiation: Transitions to agent-owned steps require explicit operator action to dispatch the next turn; no autonomous background agent spawning occurs in v1.
- **C12.** Presentation-Only UI Switch: The temporary workflow experience switch controls frontend rendering only and never alters persisted workflow engine mode or converts deterministic specifications.

## Architecture & System Design

### 1. Provider-Neutral Protocol & StepContext Authority
Agents follow a uniform 5-stage lifecycle:
```text
session receives task context
    ↓
workflow step start <change> <task>
    ↓
StepContext is authoritative
    ↓
agent performs only the current step
    ↓
workflow step finish <change> <task> --input {...}
    ↓
Nevo resolves transition
    ↓
STOP
```
The agent treats `currentStep`, `attempt`, `expectedWork`, `gates`, and `finishContract.parameters` as immutable law. It reports its outcome (`result`) only when required, resumes existing operation records upon interruption, and stops immediately when a transition completes or a human-owned step is reached.

### 2. Standard Review Loop & Human Verification Transitions
The complete standard workflow loop becomes:
```text
implementation #1
    ↓
review #1
    ├─ fail → implementation #2 (with review findings in StepContext)
    └─ pass → human-verification #1
                  ├─ approve          → verified (terminal)
                  └─ request changes  → implementation #2 (with requestedChanges in StepContext)
```
Internal engine vocabulary uses `pass` and `fail`; the UI exposes human terms `Approve` and `Request changes`.

### 3. Session ↔ Task Binding Architecture
Bindings are stored in `.nevo-ai-local/sessions/<specId>.json` as an array of `SessionTaskBinding` records:
- Each record links: `provider`, `providerSessionId`, `specId`, `taskId`, `step`, `attempt`, `createdAt`, and `lastSeenAt`.
- Captured automatically during `workflow step start` and `workflow step finish` when ambient environment variables (`NEVO_SESSION_ID`, `NEVO_AGENT_PROVIDER`) are present.
- Enables the chat UI to display all tasks associated with the current conversation and allows multiple sessions to contribute to a single task over time.

### 4. Chat Workflow Action Bar & Composer Modes
- **Task Context Bar:** Positioned above the chat composer, displaying tasks in the conversation with status badges.
- **Action Surface:** When an actionable task (e.g. in `human-verification` or awaiting step start) is selected, exposes relevant action buttons (`[ Start implementation ]`, `[ Start review ]`, `[ Request changes ]`, `[ Approve ]`).
- **Request Changes Mode:** Clicking `[ Request changes ]` transforms the composer:
  - Header: `Request changes · Task <id>`
  - Placeholder: `Provide actionable feedback for next attempt...`
  - Actions: `[Cancel]` and `[Send & reject]`
  - Submission sends explicit intent: `{ task, decision: 'request-changes', feedback }`.
  - Normal composer mode remains available for ongoing conversation.

### 5. Task-Action State Matrix (`availableActions`)
The frontend derives visible actions from authoritative backend state via a server-computed `availableActions` projection:

| Workflow State | Current / Destination Step | UI Action Label | Target Action Type |
|---|---|---|---|
| `new` / not started | `implementation` | `[ Start implementation ]` | `start-step` |
| `active` | `implementation` | *(Composer active)* | `send-message` |
| `completed` (attempt N) | `review` | `[ Start review ]` | `start-step` |
| `active` | `review` | *(Composer active)* | `send-message` |
| `completed` (review fail) | `implementation` (attempt N+1) | `[ Start implementation ]` | `start-step` |
| `completed` (review pass) | `human-verification` | `[ Request changes ]` `[ Approve ]` | `human-decision` |
| `completed` (human reject) | `implementation` (attempt N+1) | `[ Start implementation ]` | `start-step` |
| `completed` (terminal) | `verified` | *(No workflow actions; badge `✓ Verified`)* | `none` |
| `reconciliation-required` | any | `[ Operator attention required ]` | `operator-reconciliation` |

### 6. Post-Transition State Handling
- **Agent-Owned Destination (e.g. `implementation -> review`):** Once finish executes and the agent stops, the UI reloads task state and displays `Task 03 · Review ready` with `[ Start review ]`. The user decides whether to run review in the current conversation or open a new session. No background handover occurs automatically.
- **Human-Owned Destination (e.g. `review -> human-verification`):** The UI exposes `[ Request changes ]` and `[ Approve ]`. No agent session is dispatched.
- **Terminal Destination (e.g. `human-verification -> verified`):** The task is marked `verified`. No further workflow actions are rendered.

### 7. Trusted Agent Execution Context & First-Turn Resolution
- **Identity Mechanism:** When a session is created in `AgentSessionService`, Nevo dashboard server generates a canonical `sessionId` UUID.
- **Environment Inheritance:** This identity is injected into the provider child process environment:
  - `NEVO_SESSION_ID`: Nevo canonical session UUID.
  - `NEVO_AGENT_PROVIDER`: provider name (`claude`, `antigravity`, `codex`, `mock`).
  - `NEVO_SPEC_ID`: specification canonical UUID.
  - `NEVO_TASK_ID`: target task ID.
- **First-Turn Timing:** Even if native provider session allocation is lazy (unconfirmed `providerSessionId`), `NEVO_SESSION_ID` is 100% authoritative and available before turn 1 begins. When the agent runs `workflow step start`, the CLI auto-binds immediately using `NEVO_SESSION_ID`. When the provider later reports its native conversation ID via `onSessionEstablished`, `AgentSessionBindingService` correlates the native ID without breaking earlier bindings.

### 8. Hidden Prompt Context Enrichment
- When work is started (`[ Start implementation ]` or `[ Start review ]`), `AgentSessionService.startTurn` sends:
  - **Enriched Provider Prompt:**
    ```text
    [Nevo Workflow Context]
    Specification: <changeSlug>
    Task: <taskId>
    Step: <currentStep> (attempt <currentAttempt>)

    You are executing a deterministic Nevo workflow task.
    Before modifying any files or running tests, run:
      node tools/specs.mjs workflow step start <changeSlug> <taskId>
    Treat the returned StepContext as authoritative.
    Do not manually edit workflow state or change.yaml.
    Do not manually commit or push git branches.
    After successful workflow step finish, stop.
    ```
  - **User-Visible Chat Message:** Displayed in the chat bubble as clean text: `"Implement task <taskId>: <title>"`.
- Context enrichment is refreshed on the first turn of an attempt or after an explicit task switch. Intermediate conversational turns do not repeat the full bootstrap header.

### 9. Multi-Task Sessions & Single Active Task Semantics
- A single conversation may contain multiple historically bound tasks (`SessionTaskBinding[]`).
- For execution purposes, exactly **one** task is the `activeTaskId` at any time.
- When multiple tasks exist, the user explicitly clicks a task in the workflow bar to focus. The action bar renders actions strictly for the active task. Free-form chat text never triggers task switching.

### 10. Temporary UI Compatibility Switch
- A presentation-only toggle is added to the dashboard header:
  `Workflow Experience: [ Classic ] [ Deterministic Preview ]`
- Stored in client `localStorage` (`nevo:workflow-ui-mode`).
- Controls whether the new task action bar and composer action modes render for specifications with `workflow.mode: deterministic`.
- Does not change backend workflow mode and does not alter legacy specifications.
- Will be cleanly removed once deterministic workflows become standard.

## Implementation Decomposition

### Task 01: Workflow protocol, Git finalize hardening, and human decision transitions
- **Scope:** `tools/specs/workflow/`, `tools/tests/`, documentation.
- **Deliverables:**
  - `docs/development/agent-workflow-protocol.md`, `AGENTS.md`, `CLAUDE.md`.
  - Clean baseline verification on new attempt allocation in `ensureStepActivated`.
  - Whole-attempt staging (`include: ['*']` default) and clean tree noop commit in `CommitAndPushAction`.
  - `standard.yaml` update for `human-verification` (`pass -> verified`, `fail -> implementation`).
  - Direct execution in `handleWorkflowVerifyHuman` (`--approve`, `--request-changes --feedback`).
  - History feedback persistence in `finish-operation.mjs` and `StepContext.previousTransition` enrichment.
  - Integration tests in `tools/tests/workflow-e2e-loop.test.mjs`.

### Task 02: Agent execution bootstrap, trusted session context, session-task binding, and workflow server endpoints
- **Scope:** `tools/dashboard/server/`, `tools/specs.mjs`, tests.
- **Deliverables:**
  - Historical multi-task `SessionTaskBinding` and `activeTaskId` management in `AgentSessionBindingService`.
  - Canonical `sessionId` UUID allocation and ambient environment propagation (`NEVO_SESSION_ID`, `NEVO_AGENT_PROVIDER`) across Claude, Antigravity, and Codex child processes.
  - Zero-guess ambient environment auto-binding in `tools/specs.mjs` / `cli.mjs`.
  - First-turn `[Nevo Workflow Context]` prompt injection with clean `userMessage` transcript separation.
  - Server endpoint `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision`: executes `approve` (clean noop commit) / `request-changes` (attempt N+1 with feedback).
  - Server-side `availableActions` projection on task/specification read models.
  - Bootstrap integration tests in `tools/dashboard/tests/session-task-bootstrap.test.mjs`.

### Task 03: Chat surface workflow actions, composer modes, and temporary UI switch
- **Scope:** `tools/dashboard/ui/features/agent-sessions/`.
- **Deliverables:**
  - Compact task context bar rendering bound tasks with active task selection chip.
  - Action surface above composer displaying `availableActions` (`Start implementation`, `Start review`, `Approve`, `Request changes`).
  - Dedicated "Request Changes" composer mode with feedback capture, `[Cancel]`, and `[Send & reject]`.
  - Temporary UI compatibility toggle: `[ Classic ] [ Deterministic Preview ]` stored in `localStorage`.
  - End-to-end application workflow bootstrap test in `tools/dashboard/tests/e2e-product-workflow.test.mjs` exercising the complete 18-step mock sequence.

## End-to-End Walkthrough

Here is the exact step-by-step walkthrough of a task from initial dispatch to verified completion:

```text
Step 1: Start Implementation
  - UI Component/Action: Developer views Task 01 card in dashboard, clicks "[ Start implementation ]".
  - HTTP / Application Call: POST /api/agent-sessions { specId, taskId: '01', provider: 'claude', mode: 'edit' }
  - Session Operation: AgentSessionService.createSession() allocates canonical sessionId UUID, records initial binding with established: false.
  - Navigation & Turn Dispatch: Dashboard queues initial dispatch with clean userMessage="Implement task 01" and hidden [Nevo Workflow Context] header, navigates to session.
  - Process Spawn: Claude child process spawned with env NEVO_SESSION_ID=<uuid>, NEVO_AGENT_PROVIDER=claude, NEVO_TASK_ID=01.
  - CLI Invocation: Agent executes node tools/specs.mjs workflow step start demo 01.
  - Binding Written: autoBindAgentSession reads process.env; binds SessionTaskBinding(sessionId, demo, 01, implementation, attempt=1).
  - Workflow Mutation: ensureStepActivated sets workflow_progress.state = 'active', current_step = 'implementation', attempt = 1.
  - Transition Result: StepContext returned to agent with finishContract, allowed_paths.
  - Next Visible UI Action: Chat composer active, shows turn running.

Step 2: Finish Implementation
  - Agent Action: Modifies files within allowed_paths; runs tests.
  - CLI Invocation: Agent executes node tools/specs.mjs workflow step finish demo 01 --result success.
  - Workflow Mutation: finishStep runs commit-and-push (commits all changes), tags attempt-1, updates task state = 'in-review', history records implementation #1.
  - Binding Written: SessionTaskBinding refreshed (lastSeenAt updated).
  - Agent Action: Agent outputs completion summary and STOPs. Turn ends.
  - Next Visible UI Action: Dashboard refetches task; renders "Task 01 · Review ready" with "[ Start review ]".

Step 3: Start Review
  - UI Component/Action: Developer clicks "[ Start review ]".
  - HTTP / Application Call: Reuses current conversation or creates review session via POST /api/agent-sessions.
  - Process Spawn: Reviewer process spawned with ambient NEVO_SESSION_ID and NEVO_TASK_ID=01.
  - Turn Dispatch: Dispatched with review prompt and hidden [Nevo Workflow Context] header.
  - CLI Invocation: Review agent executes node tools/specs.mjs workflow step start demo 01.
  - Transition Result: StepContext returned for step=review, attempt=1.
  - Next Visible UI Action: Chat composer shows review turn in progress.

Step 4: Review Failure Loop
  - Agent Action: Reviewer audits code, runs tests, finds edge case failure, writes review artifact to specs/active/demo/reviews/task-01-attempt-1.md.
  - CLI Invocation: Agent executes node tools/specs.mjs workflow step finish demo 01 --result needs-changes --feedback "Add error handling" --artifacts specs/active/demo/reviews/task-01-attempt-1.md.
  - Workflow Mutation: finishStep verifies commit HEAD unchanged; records review #1 fail in history; transitions destination to 'awaiting-human-verification' with humanDecisionRequired: true.
  - Agent Action: Review agent STOPs.
  - Next Visible UI Action: Dashboard renders action surface: "Task 01 · Human verification · Attempt 1" with "[ Request changes ]" and "[ Approve ]".

Step 5: Human Rejection & Attempt 2 Initiation
  - UI Component/Action: Developer clicks "[ Request changes ]".
  - Composer Mode: Switches into request-changes mode. Developer enters rationale: "Please address edge case handling." and clicks "[ Send & reject ]".
  - HTTP Call: POST /api/specs/demo/tasks/01/workflow/human-decision { decision: 'request-changes', feedback: 'Please address edge case handling.' }
  - Workflow Mutation: Server executes finishStep(result: 'fail'); records human rejection in history; transitions task back to 'implementation' attempt 2.
  - Next Visible UI Action: Dashboard renders "Task 01 · In implementation (Attempt 2)" with "[ Start implementation ]".

Step 6: Implementation Attempt 2
  - Developer Action: Clicks "[ Start implementation ]" (reusing session or fresh session).
  - Turn Dispatch: Prompt enriched with [Nevo Workflow Context] attempt=2.
  - CLI Invocation: Agent calls node tools/specs.mjs workflow step start demo 01.
  - Transition Result: StepContext returned with previousTransition containing human feedback and review artifact reference.
  - Agent Action: Agent fixes edge case; runs workflow step finish demo 01 --result success -> transitions to 'in-review' attempt 2.
  - Next Visible UI Action: Dashboard renders "[ Start review ]".

Step 7: Review Pass
  - Review Execution: Reviewer runs workflow step start, tests pass, calls workflow step finish demo 01 --result success.
  - Workflow Mutation: finishStep records review #2 pass in history; transitions to 'human-verification'.
  - Review Agent: STOPs.
  - Next Visible UI Action: Dashboard renders action surface with "[ Request changes ]" and "[ Approve ]".

Step 8: Human Approval (Verified)
  - UI Component/Action: Developer inspects clean test results and clicks "[ Approve ]".
  - HTTP Call: POST /api/specs/demo/tasks/01/workflow/human-decision { decision: 'approve' }
  - Workflow Mutation: Server calls finishStep(result: 'pass'); clean tree noop commit executes; task status updated to 'verified', state = 'completed'.
  - Next Visible UI Action: Dashboard renders "Task 01 · Verified" with badge ✓ Verified. No further workflow actions available.
```

## Acceptance Criteria & Verification

### Automated Verification Plan
1. **Protocol & Engine Invariants:**
   ```bash
   node --test tools/tests/workflow-definitions.test.mjs
   node --test tools/tests/workflow-step-context.test.mjs
   node --test tools/tests/workflow-action-commit-push.test.mjs
   node --test tools/tests/workflow-human-verification.test.mjs
   node --test tools/tests/workflow-e2e-loop.test.mjs
   node tools/docs.mjs validate
   node tools/specs.mjs check
   ```
2. **Server & Binding Verification:**
   ```bash
   node --test tools/dashboard/tests/binding-service.test.mjs
   node --test tools/dashboard/tests/session-task-bootstrap.test.mjs
   node --test tools/dashboard/tests/ai-server.test.mjs
   node --test tools/dashboard/tests/specs-actions.test.mjs
   ```
3. **Application-Level E2E Bootstrap Acceptance Scenario (18-Step Proof):**
   Execute full integration test against mock provider and dashboard server (`tools/dashboard/tests/e2e-product-workflow.test.mjs`):
   1. Create/start agent conversation for spec `test-spec`, task `01`.
   2. Nevo establishes trusted execution identity (`sessionId` UUID, `established: false`).
   3. First turn receives deterministic workflow bootstrap header and clean `userMessage`.
   4. Agent-equivalent process runs `workflow step start` -> `SessionTaskBinding` created automatically via ambient `NEVO_SESSION_ID`.
   5. Implementation finish transitions to `review`; git branch committed and tagged.
   6. Implementation agent stops (no autonomous handover).
   7. Reviewer session explicitly started for task `01`.
   8. Reviewer `step start` resolves `review #1`.
   9. Review fails, writes review artifact, calls `step finish --result needs-changes --feedback ...`.
   10. Task transitions to `awaiting-human-verification` with `humanDecisionRequired: true`.
   11. Human `[ Request changes ]` dispatches `POST .../human-decision` with feedback -> transitions to `implementation #2`.
   12. Next implementation context receives human feedback in `previousTransition`.
   13. Implementation #2 finishes -> review #2 runs and passes (`--result success`).
   14. Human `[ Approve ]` dispatches `POST .../human-decision` -> transitions to `verified`.
   15. Git working tree is clean.
   16. Session history queries show all participating tasks and sessions without a 1:1 assumption.
   17. Task read models project `availableActions` accurately at each boundary.
   18. Switching active task updates `activeTaskId` without erasing prior task history.


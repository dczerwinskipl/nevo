# Area: Provider-Neutral Agent Workflow Protocol

## Purpose

Define the authoritative, vendor-neutral protocol that instructs AI agents how to interact with Nevo's deterministic workflow engine without requiring manual operator coaching, tool-specific lifecycle implementations, or prompt drift across Claude, Codex, Antigravity, and Cursor.

## Protocol Lifecycle

When an agent is dispatched to work on a task within a deterministic specification, it follows a strict 5-stage lifecycle:

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

### 1. Task Context & Protocol Injection
- Every agent session dispatched for a deterministic task receives a standardized, lightweight context header:
  ```text
  [NEvo Context: Specification '<change-slug>']
  Task: <task-id>
  Deterministic Workflow Step: start
  Protocol: Run 'node tools/specs.mjs workflow step start <change-slug> <task-id>' to retrieve your authoritative StepContext.
  ```
- The authoritative protocol definition lives in `docs/development/agent-workflow-protocol.md` and is summarized in `AGENTS.md` and `CLAUDE.md`.
- Agents must never be coached turn-by-turn with prompts like "now run step start", "now call finish", "now start review". The agent autonomously drives its assigned step to completion.

### 2. StepContext as Sole Authority
Upon executing `node tools/specs.mjs workflow step start <change> <task>`, the agent receives `StepContext` as JSON output:
- **`currentStep` & `attempt`:** The immutable identity of the active unit of work.
- **`expectedWork`:** `allowed_paths`, `forbidden_paths`, and step purpose. The agent must strictly confine edits within `allowed_paths`.
- **`relevantDocs`:** Authoritative documentation hints. The agent must prioritize supplied context over broad repository re-discovery.
- **`finishContract`:**
  - `parameters`: Exact JSON schema of required and optional inputs for `workflow step finish` (e.g. `commit.title`, `commit.message`, `result`, `artifacts`, `feedback`).
  - `gates`: Inspected entry and exit gates that must be satisfied.
- **`protocol` flags:**
  - `authoritative: true`
  - `noDirectStateMutation: true`
  - `doNotInferNextStep: true`
  - `logicalCompletionPerAttempt: true`
  - `resumableFinish: true`
  - `stopOnHumanGate: true`
- **`previousTransition`:** (When available on attempt > 1) Exposes outcome, rejection feedback, and review artifacts from the previous step/attempt.

### 3. Agent Execution Rules
During step execution, the agent must adhere to strict behavioral constraints:
1. **No Manual Workflow State Mutation:** Never edit `change.yaml`, `workflow_progress`, or task statuses directly. Never run legacy lifecycle commands (`approve`, `complete`, `verify`) on deterministic tasks.
2. **No Routing Inference or Next-Step Planning:** Never guess or choose the destination step. The agent reports its semantic outcome (`result: 'pass' | 'fail'`) only when required by `finishContract.parameters.result`; Nevo's engine owns transition resolution exclusively.
3. **No Direct Git Commit/Push:** Never run manual `git add`, `git commit`, or `git push` outside the engine's finalize mechanism.
4. **Resumable Finish:** If a finish operation is interrupted or crashes, re-running `workflow step finish` automatically resumes the in-flight durable operation rather than initiating a new logical completion.
5. **Autonomous Stop:** Upon a successful transition (`status: 'completed'`), the agent must **STOP**. It must not automatically begin the next step or attempt.
6. **Wait for Human:** When the task transitions to a human-owned step (e.g. `human-verification`), the agent must halt and wait for human action.

## Explicit Behavior Matrix

| State / Condition | Engine Response | Agent Required Behavior |
|---|---|---|
| `input-required` | `status: 'input-required'`, missing parameters listed | Construct missing parameters from `finishContract.parameters` schema and retry `finish`. |
| `gate failure / blocked` | `status: 'blocked'`, blockers listed with error reasons | Stay in the same `(step, attempt)`, correct code/tests within `allowed_paths`, and re-invoke `finish`. |
| `reconciliation-required` | Exit code non-zero, fatal error message | Stop autonomous execution immediately; alert operator without attempting manual repository repair. |
| `already-completed` | `status: 'already-completed'`, idempotent echo of prior transition | Step already finished; do not perform further edits; report completion and stop. |
| `in-flight recovery` | Resumes existing operation record | Provide original or matching inputs; do not attempt conflicting parameter mutation. |
| `human-owned step` | Step has exit gate or is human decision step (`human-verification`) | Output completion summary and STOP; wait for human operator signoff. |
| `terminal transition` | `transition.to.kind === 'terminal'` (`status: 'completed'`) | Task lifecycle is complete; inform user and stop. |

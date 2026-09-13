---
id: development.agent-workflow-protocol
type: development
title: Provider-neutral agent workflow protocol
status: current
read_when:
  - building or updating AI agent adapters (Claude, Codex, Antigravity, Cursor)
  - implementing deterministic workflow tasks or debugging step transitions
  - understanding the authoritative contract between agents and the workflow CLI
summary: >
  Authoritative, vendor-neutral execution protocol for AI agents driving Nevo's
  deterministic workflow engine: 5-stage lifecycle, StepContext authority, explicit
  behavior matrix, error handling, and Git cleanliness invariants.
related:
  - development.workflow-engine
  - development.git-workflow
---

# Provider-neutral agent workflow protocol

## Purpose

This document defines the authoritative, vendor-neutral protocol that instructs AI agents (Claude, Codex, Antigravity, Cursor, and others) how to interact with Nevo's deterministic workflow engine without requiring manual operator coaching, tool-specific lifecycle branching, or prompt drift.

When executing a task in a specification configured with `workflow: { mode: deterministic }`, all execution constraints, scope rules, parameters, and verification requirements are delivered authoritatively through `StepContext`.

## The 5-Stage Agent Lifecycle

Every agent assigned to a deterministic workflow task follows an invariant 5-stage lifecycle:

```text
1. Session receives task context
       ↓
2. Run: workflow step start <change> <task>
       ↓
3. StepContext is authoritative
       ↓
4. Agent executes only the current step within allowed_paths
       ↓
5. Run: workflow step finish <change> <task> --input {...}
       ↓
6. Engine resolves transition & commits
       ↓
7. STOP
```

### Stage 1: Session Context & Entry Instruction
When a session starts for a deterministic task, it receives ambient runtime execution identity (`NEVO_SESSION_ID`, `NEVO_AGENT_PROVIDER`) and a lightweight context entry instruction:
```text
[Nevo Workflow Context]
Specification: <change-slug>
Task: <task-id>
Step: <current-step> (attempt <attempt>)

You are executing a deterministic Nevo workflow task.
Before modifying any files or running tests, run:
  node tools/specs.mjs workflow step start <change-slug> <task-id>
Treat the returned StepContext as authoritative.
Do not manually edit workflow state or change.yaml.
Do not manually commit or push git branches.
After successful workflow step finish, stop.
```

*Note:* Session ID is never an agent-authored input or command parameter; it is exclusively resolved from trusted ambient runtime context.

### Stage 2: Step Activation & Auto-Binding
The agent initiates work by invoking:
```bash
node tools/specs.mjs workflow step start <change-slug> <task-id>
```
The CLI automatically associates the session with the task via ambient environment variables, activates the step (verifying a clean workspace baseline if starting a new attempt), and returns `StepContext` as structured JSON.

### Stage 3: StepContext Authority
The agent treats the JSON payload returned by `workflow step start` as absolute law:
- **`currentStep` and `attempt`:** The immutable identity of the active unit of work.
- **`expectedWork`:** Contains `allowed_paths` and `forbidden_paths`. The agent must strictly confine all edits to `allowed_paths`.
- **`relevantDocs`:** Authoritative documentation references. The agent must consult these before exploring repository files.
- **`stepContract`:** Contains declarative `purpose`, `expectedWork.summary`, and `hints` specific to the current step.
- **`finishContract`:**
  - `parameters`: Exact JSON schema of required and optional inputs for `workflow step finish` (e.g. `commit.title`, `result`, `artifacts`, `feedback`).
  - `gates`: Exit gates that must be satisfied before finish succeeds.
- **`previousTransition`:** Present on attempt > 1. Contains `from`, `result`, `requestedChanges`, `feedback`, and `artifacts` from the prior review failure or human changes request.
- **`protocol`:** Invariant execution flags (`authoritative: true`, `noDirectStateMutation: true`, `resumableFinish: true`, `stopOnHumanGate: true`).

### Stage 4: Step Execution
During execution:
- The agent performs only the work required for the current step (e.g., implementing code and tests during `implementation`, or auditing code and running tests during `review`).
- All edits must stay within `allowed_paths`. Touching `forbidden_paths` fails closed.
- The agent must never attempt manual Git operations (`git add`, `git commit`, `git push`).
- The agent must never manually edit `change.yaml` or fabricate workflow state.

### Stage 5: Step Completion & Stop
Upon satisfying all step requirements and verification checks, the agent calls:
```bash
node tools/specs.mjs workflow step finish <change-slug> <task-id> --input '<json>'
```
Inputs must conform to `finishContract.parameters`:
- **Implementation completion:**
  ```bash
  node tools/specs.mjs workflow step finish <change-slug> <task-id> --input '{"commit.title":"feat: implement task <id>"}'
  ```
- **Review completion (Pass):**
  ```bash
  node tools/specs.mjs workflow step finish <change-slug> <task-id> --input '{"result":"pass"}'
  ```
- **Review completion (Fail):**
  ```bash
  node tools/specs.mjs workflow step finish <change-slug> <task-id> --input '{"result":"fail","feedback":"<reasons>","artifacts":["specs/active/<change>/reviews/task-<id>-attempt-<attempt>.md"]}'
  ```

Upon receiving a successful completion response (`status: 'completed'`), the agent prints a brief completion summary and **STOPS**. It must not autonomously start the next step or attempt.

## Explicit Behavior Matrix

| Engine Status / Response | Meaning | Agent Required Action |
|---|---|---|
| `status: 'completed'` | The step finished and the engine transitioned the task. | Summarize completion concisely and **STOP**. |
| `status: 'input-required'` | Required finish inputs are missing. | Inspect `missingInputs`, supply them according to `finishContract.parameters`, and re-invoke `finish`. |
| `status: 'blocked'` | One or more entry or exit gates failed (e.g. test gate). | Remain in the same `(step, attempt)`. Fix tests or code within `allowed_paths` and retry `finish`. |
| `status: 'already-completed'` | This step/attempt was already finished previously. | Do not edit files; report completion and **STOP**. |
| `status: 'reconciliation-required'` | Repository HEAD drifted during commit or push. | Stop execution immediately; notify operator for manual reconciliation without attempting git repairs. |
| Exit code non-zero (`DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`) | Working tree was dirty when allocating a new attempt. | Do not proceed; inform operator to clean or stash uncommitted changes before starting a new attempt. |
| Transition to `human-verification` | Step requires human approval or request-changes decision. | Summarize readiness for human review and **STOP**. No agent turn is dispatched for human decisions. |
| Terminal transition (`verified`) | Task has achieved terminal verification. | Inform the user that the task is verified and **STOP**. |

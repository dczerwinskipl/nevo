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

## Ownership Boundaries & Manifest Immutability

### 1. Agents Do Not Choose or Mutate Workflow Mode
An implementation, review, or spec-writing agent must **never** autonomously choose, add, or mutate `workflow.mode` or `workflow.version` in a specification manifest (`change.yaml`).
- Workflow mode selection is strictly an **owner / product / application decision**.
- If a specification has no explicit `workflow` configuration, it is **legacy** by default.
- An agent creating or refining a specification must not add `workflow.mode: deterministic` on its own.
- An agent must not infer deterministic mode merely because a specification describes or implements workflow infrastructure.
- An agent must not change workflow mode as part of implementation or review work.

### 2. Agents Do Not Directly Mutate Lifecycle or Workflow Manifest State
Agents must **never** directly edit workflow-owned or runtime-owned lifecycle state in `change.yaml` or any manifest file during normal execution.
- **Authoring data vs. Lifecycle data:** Authoring content (overview, goals, areas, tasks design markdown) is authored by humans and agents during design phases. Lifecycle data (`status`, `workflow_progress`, `current_step`, `current_attempt`, `state`, `history`) is strictly owned and mutated by the authoritative Nevo workflow engine.
- The model expresses intent exclusively through validated tool and CLI boundaries (`workflow step start`, `workflow step finish`, human decision endpoint, or future AI application-layer tools).
- The agent must never reason: *"I need the task to be review now, so I will edit change.yaml."*

### 3. Future Direction: The AI Application Layer
In the target architecture, agents will interact with specifications and workflows strictly via an application-level tool interface:
```text
Agent / Model
     ↓
AI / Application Tool API
     ↓
Validated Nevo Command / Domain Operation
     ↓
Manifest / Workflow Persistence
```
The AI layer will eventually own operations such as creating specifications, updating authoring content, selecting workflow modes upon explicit user instruction, starting and finishing steps, and triggering human decisions. The model supplies semantic intent; Nevo owns schema validation, defaults, transition legality, and persistence provenance.

### 4. Controlled Sequencing of Deterministic Dogfooding
Specifications implementing workflow infrastructure (such as `agent-workflow-protocol-and-flow-hardening`) must not dogfood the unfinished engine. The sequencing is:
1. Complete and verify implementation under standard legacy lifecycle.
2. Verify all infrastructure and acceptance tests pass.
3. Merge the foundational pull request.
4. Create a dedicated new specification explicitly configured for deterministic mode (e.g. `spec-history-and-timeline`).
5. Run the first controlled end-to-end deterministic smoke/dogfood flow there, exercising full multi-attempt review and human verification loops.

### 5. Architectural Module Trees & Mutation Ownership
Lifecycle and status mutations are strictly partitioned into two non-overlapping module trees within the codebase:
- **Legacy mutation tree:** `tools/specs/{approve,start,complete,verify}/**` (and associated legacy CLI commands). These modules govern specifications operating under standard legacy status lifecycles (`status: draft | in-implementation | review | completed | verified`).
- **Deterministic mutation tree:** `tools/specs/workflow/**` mutation entry points (`workflow task publish`, `workflow step start`, `workflow step finish`, and human step operations `startHumanStep`, `submitHumanStepResult`). These modules govern specifications declared with `workflow.mode: deterministic`.

#### Hard Mode-Guard & Fail-Closed Routing
The CLI implements strict, fail-closed guards preventing cross-mode mutation:
- Invoking deterministic commands on a legacy specification throws `CliError` with code `LEGACY_WORKFLOW_MODE`.
- Invoking legacy lifecycle commands (`start`, `complete`, `verify`, `approve`) on a deterministic specification throws `CliError` with code `WORKFLOW_MODE_MISMATCH`.
- The CLI never silently falls back or executes legacy logic against a deterministic specification or vice-versa.
- For complete operational guidance and normative command allow/forbid sets per mode, agents must reference [.claude/skills/nevo-ai-spec-workflow/references/lifecycle-instructions.md](../../.claude/skills/nevo-ai-spec-workflow/references/lifecycle-instructions.md).

#### No-Cross-Import Boundary & Neutral Status Vocabulary (D8)
To prevent coupling between the two lifecycle architectures:
- No file under `tools/specs/workflow/**` may import `tools/specs/lifecycle-primitives.mjs`.
- Shared persistence vocabulary (`TERMINAL_STATUSES`) is extracted to `tools/specs/status-vocabulary.mjs`, providing a neutral contract without dragging legacy state transition machinery into the deterministic engine.
- This boundary is structurally enforced by automated architecture guard tests (`tools/specs/tests/lifecycle-boundary-guards.test.mjs`).

### 6. Step Executor Invariants
Deterministic workflow steps define an explicit `executor` (`agent` vs. `human`) in their step descriptors. The engine enforces strict executor separation via `assertStepExecutor`:
- **AI Agent Prohibition on Human Steps:** An AI agent must **never** attempt to start or finish human-owned steps (`executor: human`, such as verification, review sign-off, or manual checks). Any agent invocation of `workflow step start` or `workflow step finish` targeting a human step fails immediately with `WORKFLOW_STEP_EXECUTOR_MISMATCH`.
- **Human Endpoint Separation:** Conversely, human step operations (`startHumanStep`, `submitHumanStepResult`) can only be executed against human-owned steps and will reject agent-owned steps with `WORKFLOW_STEP_EXECUTOR_MISMATCH`.

### 7. Three-Way Source-Control Ownership Taxonomy (D30)
To prevent uncommitted state leaks and preserve deterministic Git finalization integrity, all operations modifying repository or manifest state are partitioned into three explicit categories:
1. **Standalone user-originated Git-tracked mutation** (e.g. `workflow task publish`, Batch Publish):
   Must finalize its own Git state (commit and push) under the git-finalize lease and workspace-writer claim (D29). It claims the shared workspace-writer slot (`kind: 'publish'` or `'batch-publish'`) for the entire operation through push, nesting the git-finalize lease around the mutate-then-commit critical section specifically.
2. **Technical activation that is part of an execution attempt** (e.g. `workflow step start`, human-step auto-activation, D27):
   Does not perform an immediate standalone Git commit. It rides along with the execution attempt it belongs to, finalized by that attempt's own eventual completion (`workflow step finish` or `submitHumanStepResult`).
3. **Completed lifecycle mutation** (e.g. `submitHumanStepResult`, `workflow step finish`):
   Already owns its deterministic finalize/commit/push lifecycle sequence, protected under git-finalize lease and workspace-writer ownership.



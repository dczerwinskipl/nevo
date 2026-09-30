---
id: adr.0009-agent-admission-and-execution-ownership-model
type: adr
title: Agent admission, execution ownership, and terminal classification model
status: accepted
date: 2026-09-30
supersedes: ~
superseded_by: ~
---

# ADR-0009: Agent admission, execution ownership, and terminal classification model

## Status

Accepted (Source: specification `deterministic-execution-follow-up-hardening`)

## Context

Prior to this decision, the interaction between AI agent sessions, physical worktree locking, and workflow attempt lifecycles lacked a formal architectural ownership model. This produced several critical failure modes in deterministic execution:

1. **Pre-activation deadlock (Scenario A):** Any dirty worktree or uncommitted change present before an agent attempt started triggered a fatal readiness check (`DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`). Because admission failed closed before creating an agent session or turn, an agent could never be admitted to inspect, stash, commit, or clean the files. Human intervention was required to break what was fundamentally an agent-remediable state.
2. **Binary settlement and spurious recovery (Scenario B & C):** When a turn ended, `assessExecutionSettlement` evaluated the workspace state using a binary boolean (`settled: true | false`). Unsettled states—including normal in-progress attempt execution (`workflow_progress.state === 'active'`), open pre-activation blockers, and interrupted finish operations—were all collapsed into `settled: false`. The orchestration runtime responded by marking the workspace-writer claim `status: 'recovery-required'`, permanently blocking subsequent admission until manual administrative recovery.
3. **Double-consumption of dependencies:** Resuming an active attempt by calling `workflow step start` re-evaluated the step start pipeline, re-planned dependency consumption, allocated a new sequence number, and overwrote dependency consumption files, violating execution idempotency.
4. **Asymmetric finish-operation handling:** Finish operations interrupted during non-destructive early stages (e.g. `verify-gates`, `update-task`) were treated inconsistently: admission blocked them as unresolvable, while settlement marked them `recovery-required`, despite the durable operation record being deterministically replayable via `workflow step finish`.

A unified architectural model was required to govern admission, ownership, and settlement without introducing new persistent claim schemas or fragile manual takeover ceremonies.

## Decision

### 1. Three-layer architectural separation

We formally separate the execution lifecycle into three distinct, non-conflated layers:

1. **Session and Turn Admission (`tools/dashboard/server/ai/orchestration/admission.mjs`, `service.mjs`):**
   Arbitrates which agent session and turn may run against a specification. Enforces the single-active-execution gate (`activeExecutions`), negotiates session reuse policies, coordinates provider turn runtimes, and manages the admission mutex (`startLocks`).
2. **Execution Ownership (`tools/specs/workflow/workspace-writer.mjs`):**
   Arbitrates exclusive physical access to the worktree via an advisory lock file (`.nevo-ai-local/workspace-writer.json`). Represents transient, single-turn ownership (`ownerId`, `sessionId`, `turnId`) rather than durable workflow state.
3. **Workflow Step Readiness & Activation (`tools/specs/workflow/readiness-policy.mjs`, `cli.mjs`):**
   Evaluates task graph prerequisites and step activation criteria. Distinguishes immutable graph preconditions (`TASK_UNPUBLISHED`, `DEPENDENCY_UNSATISFIED`, `TASK_TERMINAL`) from agent-remediable activation preconditions (`DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`, replayable `FINISH_OPERATION_UNRESOLVED`).

### 2. Execution-centric ownership model

**Core principle:** *Ownership belongs to the live execution/turn, not to the workflow attempt.*

- A workflow attempt's lifecycle (`workflow_progress`, `step`, `attempt`) persists independently in the specification manifest and durable operation logs.
- A workspace-writer claim's lifecycle is bound strictly to the live execution/turn holding it.
- When an execution turn reaches a confirmed terminal boundary, its claim must be resolved and released immediately. Releasing the claim does not advance, reset, or corrupt the workflow attempt.
- A subsequent turn or agent session may be admitted to resume the still-active or remediable attempt without requiring claim status surgery or takeover acknowledgement flags.

### 3. Shared finish-operation replayability classifier and symmetry

We establish a shared classifier for in-flight finish-operation records (`tools/specs/workflow/operation-record.mjs: isFinishOperationReplayable`):

- **Replayable finish:** An in-flight record whose persisted state demonstrates deterministic resume capability (e.g. `status === 'running'` and no irreversibly failed stages). The legal remediation path is re-executing `workflow step finish`.
- **Ambiguous finish:** A record in an uncertain, blocked, or failed state (`status === 'blocked'` or `'unknown'`). This represents genuine durable ambiguity and requires administrative recovery.

**Lifecycle symmetry (D2 second amendment):** The identical semantic classifier governs both sides of execution:
- At **admission time**, `assessTaskReadiness` treats a replayable finish as a non-fatal activation blocker, permitting agent admission for remediation, while ambiguous finishes block admission fail-closed.
- At **settlement time**, `assessExecutionSettlement` classifies a replayable finish record left behind as `resumable` (releasing the claim cleanly), while ambiguous finishes escalate to `recovery-required`.

### 4. Three-outcome terminal classification

We replace the binary `settled` boolean in `assessExecutionSettlement` with a three-outcome classification:

1. `'completed'`: The attempt genuinely advanced during execution, no in-flight operation records exist, `workflow_progress.state !== 'active'`, and in-scope files are clean. The claim is released and automatic continuation may proceed.
2. `'resumable'`: The execution turn ended safely without leaving ambiguous durable state, but legal workflow work remains. Covering three symmetric sub-cases:
   - *Active mid-flight:* `workflow_progress.state === 'active'`, no in-flight operations.
   - *Never activated:* Pre-activation remediation turn ended while an activation blocker remained open; workflow was never advanced.
   - *Replayable finish left behind:* An in-flight finish record is present and proven replayable by `isFinishOperationReplayable`.
   *Action:* The workspace-writer claim is released via `releaseWorkspaceWriterIfOwned`. `workflow_progress` is untouched, durable finish records are preserved intact, and automatic continuation is suppressed.
3. `'recovery-required'`: Genuine durable ambiguity exists (in-flight start operation record, non-replayable finish record, or post-completion dirty files). The claim is marked `status: 'recovery-required'` and blocks future admissions until repaired.

### 5. Automatic resume and terminal audit trail

In place of manual takeover ceremonies (D4), the system automatically records a queryable audit trail in the per-spec Activity store (`tools/specs/activity/store.mjs`):
- When a claim is released with `outcome: 'resumable'`, Hook 1 emits `workflow.execution.resumable` containing previous session ID, turn ID, step, attempt, and timestamp.
- On the next admission for the same `(changeSlug, taskId, step, attempt)`, `admitAgentExecution` correlates with the most recent unmatched resumable record and emits `workflow.execution.resumed` with `triggeredBy` pointing to the release activity ID.
- Activity emission failures are non-blocking; storage errors are logged and never abort claim release or admission.

### 6. Idempotent dependency consumption on resume

In `tools/specs/workflow/cli.mjs`, `handleWorkflowStepStart` inspects existing start-operation records for the exact `(step, attempt)`. If a prior start operation already reached `status: 'completed'`, subsequent activations resume in place without allocating a new `consumptionSequence` or re-recording consumption files.

## Code Locations & Implementation Map

- **Shared finish-operation classifier:** `tools/specs/workflow/operation-record.mjs` (`isFinishOperationReplayable`).
- **Readiness policy & activation split:** `tools/specs/workflow/readiness-policy.mjs` (`assessTaskReadiness`, `assessStepReadiness`).
- **Task queue evaluation:** `tools/specs/workflow/queue/evaluator.mjs` (`evaluateTaskQueue`).
- **Three-outcome terminal settlement:** `tools/specs/workflow/execution-settlement.mjs` (`assessExecutionSettlement`).
- **Agent admission & Hook 1 terminal reconciliation:** `tools/dashboard/server/ai/orchestration/admission.mjs` (`admitAgentExecution`, `reconcileHook1`, `releaseAdmittedExecution`).
- **Boot & crash reconciliation:** `tools/dashboard/server/ai/orchestration/reconciliation.mjs` (`reconcileBootState`, `reconcileContinuation`).
- **Agent session context & remediation guidance:** `tools/dashboard/server/ai/sessions/service.mjs` (`formatNevoWorkflowContext`, `checkExecutionReadiness`).
- **Dependency consumption idempotency:** `tools/specs/workflow/cli.mjs` (`handleWorkflowStepStart`).
- **Activity audit trail:** `tools/dashboard/server/ai/orchestration/admission.mjs` consuming `tools/specs/activity/store.mjs` and `actor-resolver.mjs`.

## Rejected Alternatives

1. **New persisted `resumable` status on workspace-writer claim (D3):**
   *Rejected.* A claim file represents transient mutual exclusion (`acquired` vs `released` vs `recovery-required`). Persisting attempt lifecycle status on the lock conflates lock lease ownership with task progress. Progress already has an authoritative home in `workflow_progress`.
2. **Explicit takeover acknowledgement flag (`--acknowledge-resume`, D4):**
   *Rejected.* Requiring user/agent ceremony before picking up an interrupted attempt adds friction and breaks automated headless reconciliation. If a previous turn is confirmed terminal, starting a new execution for the same active step is sufficient intent. The automatic activity audit trail provides traceability without ceremony.
3. **Duplicated per-call-site replayability checks:**
   *Rejected.* Implementing separate checks in admission (`readiness-policy.mjs`) and settlement (`execution-settlement.mjs`) would lead to semantic drift where admission allows what settlement flags as recovery-required, or vice versa. A single shared classifier guarantees lifecycle symmetry.
4. **Fatal admission blocking for all dirty worktrees:**
   *Rejected.* Treating dirty worktree state as fatal at the admission boundary created an unresolvable catch-22. Non-fatal admission with activation blocking safely admits the agent in a constrained workspace-remediation capacity without risk of corrupting step progress.

## Consequences

- Agents can be safely admitted to remediate dirty worktrees and replay interrupted finish operations without manual out-of-band intervention.
- Interrupted or abandoned turns release their claims cleanly, allowing seamless subsequent resumption.
- Ambiguous durable operations (start operations and failed finish operations) remain strictly fail-closed.
- Lock ownership remains decoupled from workflow progress schemas.
- Execution continuity and resume handoffs are fully traceable via the Activity audit trail.

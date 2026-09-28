---
name: multi-task-review
description: Reviewer execution contract for a batched review session. Reads shared BatchContext, conducts independent per-task reviews and cross-task consistency checks, writes canonical batch report, and submits single batch-finish call.
user-invocable: false
---

# Multi-task review skill

This skill defines reviewer agent behavior for a batched review session (`kind: "task-batch"`).
It governs how the agent conducts the review, assesses member tasks, records findings, and completes
the review turn.

## 1. Skill vs. orchestrator boundary

This skill defines strictly **how** the agent performs a batched review.
It does **not** define:
- **What** tasks the session owns: that is determined by the authoritative `ExecutionScope` (`{ kind: 'task-batch', taskIds }`) established by the orchestration and queue reservation layer (`execution-scope-model`, `batch-queue-reservation`).
- **How results are committed and applied**: that is owned by `batch-finish-operation`, which performs atomic validation, per-task lifecycle transitions, report commit, and subsequent continuation settlement (`batch-completion-orchestration`).

A reviewer agent must never attempt to redefine its assigned scope or manually manipulate lifecycle status fields.

## 2. Execution bootstrap: call `workflow batch start` first

The agent's very first required action is to call `workflow batch start`:
```bash
node tools/specs.mjs workflow batch start <change> --batch <batchExecutionId>
```
- **Never assume `BatchContext` arrives in any other way.**
- **Never call N single-task `workflow step start` commands.** The batch-start operation verifies trusted ambient session identity and queue reservation, prospective capacity limits, activates all member tasks idempotently, records the post-bootstrap baseline fingerprint, and returns the authoritative, deduplicated `BatchContext`.
- Read the returned shared context (`BatchContext.shared`) once: shared specification overview, shared dependencies, deduplicated required context documents, and common architecture constraints.

## 3. Read-only execution capability profile (D4, D22)

Batched review operates under a strict **read-only execution capability profile** over repository source code:
- **No source-file modifications are permitted.** The reviewer must not edit, create, or delete any source files, test files, or specification manifests under review.
- **Allowed writes are strictly limited to:**
  1. The canonical review report at `reviews/review-batch-<batchExecutionId>.md`.
  2. The final `workflow batch finish` command invocation.
- **The reviewer session makes NO Git commit of its own, ever.** The reviewer must never run `git commit` or `git push`. The batch-finish operation owns staging and committing the canonical report in a dedicated batch-level commit.
- **Failing tasks hand off to a fresh single-task refiner:** If a task fails review, the reviewer does not attempt to fix the task inline. The failed task's remediation will be handled by a dedicated, fresh single-task refiner session dispatched automatically after batch settlement, inheriting this batch reviewer session as its `parentSessionId`.
- **Contrast with single-task review:** Single-task review retains its existing capability profile (including corrective edits or task-level commits where configured in the workflow definition). Batched review enforces read-only inspection to preserve clear file ownership, attribution, and non-conflicting multi-task provenance.

## 4. Mandatory control-plane enforcement (D27, D39)

Correctness of the read-only profile does **not** depend on prompt adherence or provider-side sandboxing:
- **Mandatory enforcement:** `batch-finish-operation` performs an automated control-plane provenance verification before accepting any batch finish. It verifies that `HEAD == baseRevision` and recomputes the complete repository-visible workspace-delta fingerprint (staged, unstaged, and untracked files). Excluding `.nevo-ai-local/**` and the canonical report path, this fingerprint must match the frozen post-bootstrap baseline exactly.
- **Nevo bootstrap delta tolerance:** Control-plane modifications legitimately performed by Nevo's own bootstrap (such as `change.yaml` step activations) are permitted because they match the post-bootstrap baseline. Any other change made during the review turn causes the batch finish to be rejected immediately.
- **Provider tool sandboxing is optional defense-in-depth only:** Where a model provider supports restricting file-write tools, that sandboxing may be applied as defense-in-depth. Correctness and enforcement are guaranteed by the control plane regardless of provider capabilities.

## 5. Review procedure

### Step 5.1: Analyze shared context and cross-task relationships
- Inspect `BatchContext.shared` and `BatchContext.crossTask`.
- Identify overlapping files (`crossTask.sharedFiles`), shared contracts, and declared dependencies between member tasks.
- Ensure awareness of how changes in one task interact with or affect another.

### Step 5.2: Independent per-task evaluation
- Review each member task independently against its own acceptance criteria, task definition, and diff:
  - Inspect files declared in each task's `allowed_paths`.
  - Evaluate implementation against acceptance criteria in the task specification.
  - Verify that tests for the task pass.
- **Never allow one task's pass to hide another task's failure.** Each member task must receive its own independently evaluated outcome based on its own merits. An obvious pass on task A must never cause superficial or lenient review on task B.
- **No aggregate batch verdict:** The reviewer must never formulate, assign, or report a single aggregate "batch verdict" (such as "batch passed" or "batch failed"). Only discrete, per-task verdicts exist.

### Step 5.3: Cross-task consistency and integration checks
- Perform a distinct cross-task inspection pass:
  - Verify that member tasks do not introduce conflicting assumptions, duplicate symbols, or incompatible interface changes.
  - Verify that shared files modified across tasks maintain internal coherence.
- Formulate cross-task findings where applicable:
  - Each cross-task finding must explicitly list its `affectedTaskIds` (`affectedTaskIds: ['task-1', 'task-2']`).
  - Unattributed, vague, or batch-wide generic notes are prohibited.

### Step 5.4: Generate canonical review report
- Render the shared batch review report and write it to:
  `reviews/review-batch-<batchExecutionId>.md`
- The report includes:
  - Executive summary and table of evaluated tasks.
  - Per-task sections detailing acceptance criteria compliance, verified files, and verdict.
  - Cross-task analysis and findings with explicit task attribution.
  - Next steps (advancement for passed tasks, refiner handoff for failed tasks).

## 6. Single batch-finish call

Review work terminates in **exactly one** batch-finish invocation:
```bash
node tools/specs.mjs workflow batch finish <change> --batch <batchExecutionId> --results '<json-results>'
```
- **Single finish call requirement:** All member task results and cross-task findings must be submitted together in one call.
- **No per-task finish guidance:** The reviewer must **never** invoke `workflow step finish` on individual tasks. Doing so would violate the action barrier, cause workspace contention, and fail closed.
- **Result schema:**
  - Each task's `result` must correspond to a valid transition value declared in that task's step definition (e.g. `pass` or `fail` for standard review steps).
  - Feedback should be provided for tasks requiring refinement:
    ```json
    {
      "results": {
        "task-1": { "value": "pass", "feedback": "All acceptance criteria verified." },
        "task-2": { "value": "fail", "feedback": "AC3 failed: edge case with null input causes unhandled rejection." }
      },
      "crossTaskFindings": [
        {
          "summary": "Shared utility signature divergence",
          "details": "task-1 updated format() but task-2 relies on previous signature",
          "affectedTaskIds": ["task-1", "task-2"]
        }
      ]
    }
    ```
- Once `workflow batch finish` returns successfully, the review turn is complete. The orchestration system will release the workspace claim, clear the batch execution, release the action barrier, and dispatch continuations for all member tasks.

---
id: adr.0011-workflow-owned-derived-artifacts-and-transition-aware-gates
type: adr
title: Workflow-owned derived artifacts and transition-aware exit gates
status: accepted
date: 2026-10-10
summary: Establish deterministic workflow engine ownership of generated repository artifacts and transition-aware exit gate evaluation with replayable failure recovery.
supersedes: ~
superseded_by: ~
---

# ADR-0011: Workflow-owned derived artifacts and transition-aware exit gates

## Status

Accepted (Source: specification `exit-gate-improvements`, Owner Decisions D1–D6)

## Context

Implementation of `ai-spec-history` exposed two structural defects in the deterministic workflow engine:

1. **Derived-artifact drift and ownership collision:** Generated repository artifacts (such as `specs/index.generated.json`, `specs/active.generated.md`, `specs/archive.generated.md`, and `docs/*.generated.*`) were regenerated exclusively by legacy lifecycle commands or manual scripts. Deterministic workflow mutations (`workflow step start`, `workflow step finish`, `workflow task publish`, and batch finish) mutated source state (e.g. `change.yaml`) without synchronizing generated indexes. Furthermore:
   - `specs/index.generated.json` embedded each task's full `workflow_progress`, causing index drift even on non-finalizing `step start` calls.
   - Generated files were not in any task's `allowed_paths` and were absent from `workflowOwnedPaths`. As a result, agents could not update them, and the commit action rejected generated updates as out-of-scope worktree modifications (`OUT_OF_SCOPE_WORKTREE_CHANGES`).
   - `writeDocsIndexes` stamped a new generation timestamp on every invocation, creating phantom git diffs even when content was unchanged.

2. **Rigid exit gate evaluation and blocked negative reviews:** Exit gates were evaluated uniformly at the step level for every transition:
   - In standard review steps, automated verification gates ran unconditionally. When implementation tests failed, reviewers could not transition to `fail` because the red tests that justified the failure blocked the exit gate.
   - When an exit gate failed, the engine recorded `record.status = 'blocked'` and pinned `resolvedInputs`. Retrying with a different transition result (e.g. switching from `pass` to `fail`) triggered `RESOLVED_INPUT_CONFLICT`, deadlocking the task in an unresolvable state.
   - Runner execution exceptions (such as process spawn errors or missing tools) were conflated with non-zero exit codes as `status: failed`, confusing infrastructure failures with negative verification evidence.
   - The CLI heuristic string-matched `'npm test'` to substitute task `## Verification` commands, preventing workflows from running literal `npm test` or declaring task-level verification explicitly in workflow definitions.

## Decision

We establish authoritative workflow-level ownership of derived repository artifacts and transition-aware exit gate evaluation across two complementary areas:

---

### Area A: Derived-Artifact Ownership and Selective Synchronization

#### 1. Static Generator Registry
Rather than a heavyweight plugin system or declarative workflow configuration, we define a small, static in-process generator registry (`tools/specs/derived/registry.mjs`). Each generator declares:
- `id`: unique generator identifier (e.g. `specsIndexes`, `docsIndexes`).
- `inputs`: glob patterns matching source files that invalidate the generator (e.g. `specs/active/*/change.yaml`, `docs/**/*.md`).
- `outputs`: exact, non-glob repository-relative file paths produced by the generator.
- `sync(ctx)`: asynchronous execution function writing deterministic outputs.
- `check(ctx)`: in-process verification function checking on-disk synchronization without side effects.

#### 2. Selective Planning (`planDerivedSync`)
Derived artifact synchronization is selective: given the set of dirty files in the workspace, `planDerivedSync` triggers only generators whose declared `inputs` match at least one modified path. Operations touching only specification manifests trigger `specsIndexes`; operations touching only documentation trigger `docsIndexes`.

#### 3. Single Transactional Sync Point (Inside `ensureCommit`)
Synchronization occurs inside the `commit` stage (`ensureCommit`), after domain state mutations (`update-task`) have written to disk, before `commit-and-push` is invoked, and entirely within the `withGitFinalizeLock` critical section.
- **Other sync sites:** `workflow task publish` synchronizes derived artifacts before its commit, widening its commit set from `[change.yaml]` to `[change.yaml, ...written]`. Batch finish synchronizes derived artifacts prior to its Stage 5 shared commit.
- **Never at `step start` or `--check`:** Step activation and non-mutating finish checks never synchronize derived artifacts. `step start` strictly enforces a clean working tree baseline (modulo `.nevo-ai-local/**` and `change.yaml`).

#### 4. Explicit Path Ownership Grant (`resolveDerivedOwnedPaths`)
`resolveDerivedOwnedPaths(plan)` resolves the **exact output paths of the generators that actually ran** during the operation. The commit action's scope validation accepts:
$$\text{allowed\_paths} \cup \text{workflowOwnedPaths} \cup \text{derivedOwnedPaths}$$
No broad directory grants or glob expansions are permitted. Any dirty file outside this exact union remains strictly rejected as `OUT_OF_SCOPE_WORKTREE_CHANGES`.

#### 5. Cleanliness Precondition and Integrity Verification
- **Precondition:** Before executing generators, the engine asserts that every dirty file matching a triggered generator's inputs belongs to the current operation's authorized commit set (`allowed_paths ∪ workflowOwnedPaths`). If foreign dirty files match, sync fails closed with `DERIVED_INPUT_DIRTY_OUTSIDE_OPERATION` without writing any outputs.
- **Post-generation verification:** Immediately after generation, triggered generators execute their in-process `check()`. Mismatches throw `DERIVED_INTEGRITY_FAILED`. Additionally, repo-wide `validate` runs in-process for specs and docs; violations throw `REPO_INTEGRITY_FAILED`.

#### 6. Determinism and Projection Stability
- `writeDocsIndexes` preserves the prior timestamp when content has not changed, eliminating phantom diffs.
- `specs/index.generated.json` omits `workflow_progress` (D4(i)), ensuring the committed index does not drift upon step activation.

---

### Area B: Transition-Aware Exit Gates and Replayable Failure Recovery

#### 1. Declarative `when:` Filtering on Exit Gates
Exit gates declare an optional `when: [<result>...]` array specifying the transition result values under which the gate must be evaluated.
- If `when` is omitted or empty, the gate is evaluated for all transitions (preserving backward compatibility).
- In `standard.yaml` and `standard-v1.yaml`, the `review` step's verification gate specifies `when: [pass]`, while the `fail` transition requires explanatory feedback (`action.feedback.required: true`).

#### 2. Filtered Evaluation at Choke Points
`filterExitGatesByResult` serves as the authoritative choke point in both `planFinish` and `ensureVerifyGates`. Only gates matching the resolved transition `result` are inspected or verified.

#### 3. Replayable Gate Failure State
When a required exit gate fails during `ensureVerifyGates`:
- The operation record remains in `status: 'running'` (with `verify-gates` marked `failed`), rather than locking into `blocked`.
- `mergeResolvedInputs` allows revising `result`, `feedback`, `commit.title`, `commit.message`, and `artifacts` on replay, provided `update-task` is still `pending`.
- Once `update-task` begins, all resolved inputs are strictly pinned.
- Settlement diagnostics report the operation as `resumable`, not `recovery-required`.

#### 4. Failure Taxonomy
The engine strictly distinguishes:
- **`failed`**: The gate executed to completion and returned a non-zero exit code or failed status. This represents negative verification evidence and is recorded in the verification store.
- **`blocked`**: An infrastructure or runtime exception prevented execution (e.g. runner exception, spawn failure, missing verification store). Runner exceptions do not pollute the verification store with erroneous failure records.

#### 5. Explicit `task-verification` Catalog Action
String-matched substitution of `'npm test'` in `runCliCommandWithLiveOutput` is eliminated. The catalog defines an explicit `task-verification` action that parses and runs the task's `## Verification` commands. Workflow definitions declare `action: task-verification` where task verification commands are intended, while `action: test` strictly executes literal `npm test`.

---

## Consequences

### Positive
- Workflow transitions atomically commit both domain changes (`change.yaml`) and resulting index updates in a single commit, eliminating repository drift.
- Review steps can legitimately reject unsatisfactory implementations (`result: fail`) without being blocked by the failing tests.
- Infrastructure errors are no longer misconstrued as negative verification evidence.
- Gate failures do not dead-end the finish operation; callers can rectify inputs or re-run without manual operation-record patching.
- Command execution is explicit in workflow definitions rather than heuristic.

### Neutral / Trade-offs
- An unrelated validation defect anywhere in the repository will trigger `REPO_INTEGRITY_FAILED` and block workflow finalization until resolved. This is intentional to prevent committing broken states to CI.
- Pinned `standard-v1` specifications receive in-place updates to `review` gate configuration, representing a deliberate behavior refinement.
- Generated `specs/index.generated.json` no longer contains task `workflow_progress`. Tools requiring real-time progress inspect `change.yaml` directly.

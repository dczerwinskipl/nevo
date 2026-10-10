---
id: spec.exit-gate-imorovements.discovery
type: change
title: "Exit gate improvements — discovery"
status: draft
change: exit-gate-imorovements
---

# Discovery — derived-artifact ownership and transition-aware exit gates

Discovery performed 2026-10-10 on branch `feature/ai-spec-history` (HEAD `d2132892`).
Everything under **Repository facts** was read directly in code; everything under
**Proposals** is an architectural suggestion and is explicitly not a decision. Items marked
*(unverified)* were not confirmed against runtime behavior.

## Scope

Two defects surfaced during real execution of `ai-spec-history` (PR #53):

1. Generated indexes went stale after workflow-owned `change.yaml` mutations and eventually
   blocked a task's exit gate.
2. A failing verification command prevented a reviewer from recording a legitimate
   `fail` review result.

## Repository facts

### Mutation and generation inventory

| Operation | Mutates | Commits | Regenerates indexes |
|---|---|---|---|
| `workflow step start` (`cli.mjs` → `ensureStepActivated`, `step-context.mjs:283`) | `change.yaml` (`workflow_progress.state=active`) | no — stays dirty until `finish` | no |
| `workflow step finish` (`finish-operation.mjs`, `ensureUpdateTask`) | `change.yaml` (`workflow_progress`, terminal `status`) | yes, `commit` stage via `commit-and-push` | **no** |
| `workflow task publish` (`publish/operation.mjs:392`) | `change.yaml` (`status: approved`) | yes, **only** `[change._file]` | no |
| `workflow batch finish` (`batch-finish/operation.mjs`) | per-member `change.yaml` via `finishStep` (sourceControl disabled per member) + review report | one shared commit (stage 5), no scope constraint passed | no |
| human step / `verify-human --approve` (`human-step/operations.mjs`) | `change.yaml` via `finishStep` | via `finishStep` | no |
| Legacy `approve`, `verify`, `finalize`, `self-check`, spec create (`identity.mjs`), `backfill-spec-id`, `generate` | `change.yaml` / indexes | varies | **yes** — each calls `buildSpecsIndexes`/`writeSpecsIndexes` inline |
| `docs.mjs generate` | `docs/index.generated.*`, `docs/routing.generated.json` | no | manual only; no workflow path invokes it (`grep` over `tools/specs/workflow/`) |

The deterministic engine (`tools/specs/workflow/**`) contains **no** call to either index
generator. Only the legacy lifecycle does.

### Nature of the generated artifacts

- `specs/index.generated.json`, `specs/active.generated.md`, `specs/archive.generated.md`
  are pure functions of every `change.yaml` under `specs/active` and `specs/archive`
  (`indexes.mjs`, `buildSpecsIndexes`). They are **projections, not authoritative**: the
  dashboard reads manifests directly (`dashboard/server/specs/service.mjs` →
  `loadDashboardData`); no `tools/` runtime consumer of `index.generated.json` was found
  *(consumer inventory in docs/skills still to be confirmed by task 01)*. Their one
  enforced role is the CI/`specs.mjs check` freshness assertion.
- The JSON projection embeds each task's **whole** `workflow_progress` (all `history`,
  `feedback`, `sessionId`s). Consequently *every* `step start`/`finish` of *any* task
  changes the expected index (`ai-spec-history` produced a 124-line diff). This is why the
  index goes stale on every single deterministic operation.
- `docs/index.generated.*` and `docs/routing.generated.json` are pure functions of
  `docs/**/*.md` front matter and the routing tables (`docs/service.mjs`). Specification
  artifacts live under `specs/`, so they do not affect the docs index.

### Determinism / idempotency

- `writeSpecsIndexes` keeps the previous `generated` timestamp when `changes` is
  unchanged (`indexes.mjs:59-66`) → idempotent. The Markdown has no timestamp.
- `writeDocsIndexes` (`docs/service.mjs:141`) stamps `new Date()` **unconditionally**
  into `index.generated.json` and the `_Generated:` line of `index.generated.md` →
  **every `docs.mjs generate` dirties both files even with identical inputs.** The
  *check* ignores the timestamp, so freshness is unaffected, but a workflow-owned sync
  would create phantom diffs/commits until this is fixed.

### Finish operation structure

- Stage order is fixed: `verify-gates → update-task → commit → push → transition`
  (`FINISH_STAGE_IDS`, `finish-operation.mjs:30`), persisted in
  `.nevo-ai-local/workflow-operations/<change>/<task>/<step>.json`.
- The operation record (with `resolvedInputs`) is created and saved **before**
  `verify-gates` runs (`finishStep`, line ~780-789).
- `update-task` and `commit` run inside `withGitFinalizeLock` (line 796); `verify-gates`
  runs outside it; `push` and `transition` after.
- `ensureCommit` reconciles `running`/`unknown` by comparing HEAD to
  `intent.preCommitHead`: unchanged HEAD ⇒ safe to re-execute; changed HEAD with matching
  parent+subject ⇒ completed; otherwise `reconciliation-required`.
- `resolveWorkflowOwnedPaths` recognizes only `specs/active/<change>/change.yaml` and
  `specs/active/<change>/reviews/**`. `commit-and-push` rejects any dirty path outside
  `allowed_paths ∪ workflowOwnedPaths` with `OUT_OF_SCOPE_WORKTREE_CHANGES`
  (`commit-and-push.mjs:250-266`) — **but only when a scope constraint exists**; the batch
  shared commit passes no `taskAllowedPaths`, so it is unconstrained.
- `assertCleanWorktreeForNewAttempt` (`step-context.mjs:257`) exempts only
  `.nevo-ai-local/**` and `*/change.yaml`. Any other dirty file, including a stale or
  regenerated index, blocks `step start` with `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`.
- Repeat `finish` on an already-finished step returns `already-completed` without
  re-running gates or actions (`planFinish`, AC7).

### Why the `ai-spec-history` exit gate blocked (stale-index root cause)

1. `step start` writes `change.yaml` (`state: active`); the committed index no longer
   matches the worktree manifest.
2. The task's own `## Verification` (task 08) lists `node tools/specs.mjs check`; the
   `review` step's `test` gate runs exactly those commands (below). `check` fails against
   the worktree because of (1) and of the nine earlier unregenerated commits.
3. No engine stage ever regenerates the index, and the index is not in any task's
   `allowed_paths`, so an agent cannot legitimately fix it from inside the task.

### How verification commands are selected

- The step gate is `{ type: command, action: test }`; the catalog maps `test → npm test`
  (`gates/command-catalog.mjs`).
- The CLI runner (`runCliCommandWithLiveOutput`, `cli.mjs:135`) special-cases the literal
  string `'npm test'`: when a task Markdown file has a `## Verification` fenced block
  (`parseVerificationCommands`, `fingerprint.mjs:126`) it runs **those** commands
  sequentially (stopping at the first failure) instead. If the task has none, it falls
  back to real `npm test`. The alias `test` therefore means "this task's verification
  commands" only through a string comparison in a runner closure.
- `batch finish` builds its registry with the same `buildWorkflowGateRegistry`
  (`batch-finish/operation.mjs:312`), so CLI and dashboard batch share semantics today.
  Human steps pass `context.gateRegistry` (may be undefined → default registry with no
  runner/store); they declare no command gates so this is latent only.

### Why `review fail` cannot be recorded when checks fail

- Exit gates belong to the **step**, not to a transition (`standard.yaml`: `review.exitGates:
  [command test]`, transitions `pass` / `fail`). `planFinish`/`ensureVerifyGates` evaluate
  them identically for every `result`; there is no transition-aware evaluation.
- A red gate sets `verify-gates` stage `failed`, `record.status = 'blocked'`
  (`ensureVerifyGates`). Consequences, all verified in code:
  - `finish` returns `blocked`; `update-task` never runs, so the `fail` result is never
    recorded.
  - `resolvedInputs` (including `result`) were already persisted on the record, so a
    later call that changes `result` (e.g. first `pass`, then `fail`) is rejected by
    `mergeResolvedInputs` with `RESOLVED_INPUT_CONFLICT`.
  - `isFinishOperationReplayable` returns `false` for `record.status !== 'running'`, so
    `assessExecutionSettlement` classifies the task `recovery-required` rather than
    `resumable` (`execution-settlement.mjs:167-177`), and the cli-manual writer claim is
    marked recovery-required instead of released.
- Runner exceptions and test failures are collapsed to the same `passed:false` →
  `status: 'failed'` (`command-gate.mjs:326-331`); only a missing verification store yields
  `blocked`. Infrastructure error and negative evidence are not distinguishable.
- `review` `fail` does not currently require `feedback` (`human-verification`'s does), so
  a recorded `fail` could carry no findings.

### ask_user timeout *(partially unverified)*

Findings reach the engine only through `finish --input` (`feedback`, `artifacts`); they
live in the persisted `resolvedInputs` once a record exists, i.e. they survive a blocked
gate. The `ask_user` MCP tool (`dashboard/server/ai/interactions/mcp/`) shows no
engine-side timeout handling; its turn-token expiry produces an error to the agent, not a
workflow state. Whether a reviewer can still call `finish --input` after an expired
question was **not** exercised and needs a test in task 06 (the structural fix is that
findings are submitted through `finish`, never through the question tool).

### CI

`.github/workflows/tool-tests.yml` runs `npm run specs:check` and `npm run docs:check`
after tests on every push. It already detects stale committed outputs (it did for PR #53)
and requires no change; a regression test for it exists (`e2e-workflow.test.mjs`
REC-03).

## Inconsistencies

- Legacy lifecycle owns index regeneration; the deterministic engine, which superseded it
  for execution, does not (owner already recorded this in memory, 2026-10-10).
- `docs/index.generated.*` appears in some tasks' `allowed_paths` (e.g. `ai-spec-history`
  task 08) while `specs/index.generated.json` appears in none — generated outputs are
  handled ad hoc per task.
- The `test` alias resolves to `npm test` in the catalog but to task Markdown commands at
  runtime.
- `.nevo-ai/workflows/` holds both `standard.yaml` (id `standard-v1`) and
  `standard-v1.yaml`; not investigated further here.

## Open questions → see overview.md "Owner decisions required"

## Proposals (not decisions)

See `overview.md` — options, recommendation and decomposition.

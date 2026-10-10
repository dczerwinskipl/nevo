---
id: spec.exit-gate-imorovements
type: change
title: "Exit gate imorovements"
status: draft
change: exit-gate-imorovements
---

# Exit gate improvements — derived-artifact ownership and transition-aware gates

Status: **draft, awaiting owner decisions D1–D6 below.** Nothing here is approved or
implemented. Evidence for every claim is in [`discovery.md`](discovery.md).

Classification: **A (architectural)** — touches transaction semantics, persistence
ownership and compatibility (all `AGENTS.md` owner-approval items), and the workflow
engine's durable operation model.

## Context

`ai-spec-history` (PR #53) exposed two defects in the deterministic workflow engine:

1. generated repository indexes drift after every workflow-owned `change.yaml` mutation
   and eventually block an unrelated task's exit gate;
2. a red verification command prevents a reviewer from recording a legitimate `fail`
   review result.

Guiding principle: **AI agents own reasoning and task-specific source changes;
deterministic workflow infrastructure owns lifecycle transitions, generated artifacts,
integrity enforcement and source-control orchestration** — identically across CLI,
dashboard, batch execution and recovery.

## Problem and verified root causes

| # | Root cause (verified in code) | Effect |
|---|---|---|
| R1 | No engine stage regenerates indexes; only legacy lifecycle ops do. | Every `step start`/`finish`/`publish`/`batch finish` leaves `specs/*.generated.*` stale. |
| R2 | The specs JSON index embeds each task's full `workflow_progress`. | Even a mid-step `step start` makes the worktree disagree with the committed index. |
| R3 | Generated outputs are in no task's `allowed_paths` and not in `workflowOwnedPaths`. | Agents cannot fix them; `commit-and-push` would reject them as out of scope. |
| R4 | A task's own `## Verification` may contain repo-wide checks (`specs.mjs check`) and is what the `test` gate runs. | Repo-state failures masquerade as task-verification failures. |
| R5 | `writeDocsIndexes` always stamps a new timestamp. | Any automatic docs sync would create phantom diffs. |
| R6 | Exit gates are step-level; `finish` evaluates them for every `result`. | `review fail` is blocked by the same red tests that justify it. |
| R7 | A red gate persists `record.status='blocked'` with `resolvedInputs` pinned. | Result cannot be changed (`RESOLVED_INPUT_CONFLICT`); settlement says `recovery-required`. |
| R8 | Runner errors and red tests both map to `status: failed`. | Infrastructure failure indistinguishable from negative evidence. |

## Proposed architecture

Two independent areas. Boundary recommendation (D1): keep one change with two areas now;
the areas share no code and only meet in the test matrix, so the owner may split them
into two changes at approval time at no cost.

### Area A — derived-artifact ownership ([`areas/01-derived-artifacts.md`](areas/01-derived-artifacts.md))

**A small, static generator registry** — not a plugin framework:

```
tools/specs/derived/registry.mjs   // DERIVED_GENERATORS = [ specsIndexes, docsIndexes ]
{ id, inputs: [globs], outputs: [exact paths], sync(ctx) -> { written: [paths] }, check(ctx) -> problems[] }
```

- `specsIndexes`: inputs `specs/active/*/change.yaml`, `specs/archive/*/change.yaml`;
  outputs `specs/index.generated.json`, `specs/active.generated.md`,
  `specs/archive.generated.md`; wraps existing `buildSpecsIndexes`/`writeSpecsIndexes`/
  `checkSpecsIndexes` (no logic duplicated).
- `docsIndexes`: inputs `docs/**/*.md`; outputs `docs/index.generated.json`,
  `docs/index.generated.md`, `docs/routing.generated.json`; wraps existing
  `tools/docs/service.mjs` functions.
- `planDerivedSync(dirtyPaths)` selects generators whose `inputs` match a path changed in
  this operation — selective, never "regenerate everything". A new generator = one array
  entry; no engine change.

**One shared post-mutation entry point**, `syncDerivedArtifacts({ repoRoot, commitSet })`,
called at every site that mutates source state and then commits:

| Site | Where it runs |
|---|---|
| `finishStep` | inside `ensureCommit`, after `update-task`, before `commit-and-push` (already within `withGitFinalizeLock`) |
| `batch finish` | before stage-5 shared commit |
| `workflow task publish` | before its commit (and its commit set widens from `[change.yaml]` to `[change.yaml, ...written]`) |
| legacy `approve`/`verify`/`finalize`/`self-check`/create | later cleanup: replace inline `writeSpecsIndexes` with the shared call (follow-up, not required) |

**Never** at `step start`, `finish --check`, or context compilation: start already dirties
`change.yaml`; syncing there would add more uncommitted state to a tree whose
cleanliness is a hard precondition (D13).

**Ownership.** `resolveWorkflowOwnedPaths` is unchanged (per-change `change.yaml` +
`reviews/**`). A new `resolveDerivedOwnedPaths(plan)` returns the **exact output paths of
the generators that actually ran in this operation** — no globs, no directory grants, no
change to `allowed_paths` semantics. The commit action's scope check accepts
`allowed_paths ∪ workflowOwnedPaths ∪ derivedOwnedPaths`; anything else remains
`OUT_OF_SCOPE_WORKTREE_CHANGES`. Settlement diagnostics treat all registered generator
outputs as owned so a half-finished sync is not misreported as foreign drift.

**Unrelated dirty files.** Before generating, the sync asserts that every dirty path
matching a triggered generator's `inputs` belongs to this operation's commit set
(`allowed_paths ∪ workflowOwnedPaths`); otherwise it fails with
`DERIVED_INPUT_DIRTY_OUTSIDE_OPERATION` and writes nothing. This prevents an index from
embedding another change's uncommitted state, and prevents staging foreign files
(staging stays by explicit path set, as today).

**Integrity validation (logical step 4).** After generating, run the triggered
generators' own `check()` in-process. A mismatch is `DERIVED_INTEGRITY_FAILED`. Repo-wide
`validate` is deliberately **not** run here (an unrelated spec's validation error must
not block this task); see D5.

**Determinism.** Make `writeDocsIndexes` preserve the prior `generated` timestamp when
content is unchanged (as `writeSpecsIndexes` already does) so sync is a no-op on a clean
tree. Resolve R2 per D4.

### Area B — transition-aware gates ([`areas/02-transition-aware-gates.md`](areas/02-transition-aware-gates.md))

Separate five concepts that are currently conflated:

| Concept | Owner | Evaluated |
|---|---|---|
| Task acceptance verification | task `## Verification` via `test` gate | step exit gate |
| Workflow transition requirements | gate `when:` + transition `action.feedback.required` | per resolved `result` |
| Repository-wide integrity | engine, Area A `check()` | after sync, before commit |
| Generated-artifact synchronization | engine, Area A | inside finish transaction |
| Infrastructure failure | typed error codes, never a review outcome | any stage |

Changes:

1. **`when` on exit gates** (schema + loader): optional `when: [<result>...]`. Absent ⇒
   all transitions (full backward compatibility; unconditional steps unaffected).
   `standard.yaml` `review` gains `when: [pass]` on the command gate, and
   `action.feedback.required: true` on `fail` so findings cannot be lost. `result` is read
   only from the persisted, conflict-checked `resolvedInputs.result`, never from a
   caller-supplied side channel.
2. **Filtered evaluation at one choke point.** `planFinish` and `ensureVerifyGates`
   filter `step.exitGates` by the resolved result. `finishStep` is already the single path
   for CLI, human step and batch member finish, so CLI/dashboard parity is structural.
3. **Gate failure is a clean, replayable pre-mutation state.** A red gate (for a result
   that requires it) leaves `record.status` replayable (`running`, `verify-gates:
   failed`), and `mergeResolvedInputs` permits changing `result`/`feedback` while
   `update-task` is still `pending` (nothing durable has happened). Settlement reports
   `resumable`, not `recovery-required`. Security/ownership unchanged: once `update-task`
   starts, inputs are pinned exactly as today.
4. **Failure taxonomy.** Gate verification distinguishes `failed` (check ran and was red —
   negative evidence) from `blocked`/`error` (could not evaluate: runner exception, spawn
   failure, missing store). Only `failed` can ever be treated as evidence for a `fail`
   review; infrastructure errors never silently satisfy or replace one.
5. **Explicit task-verification semantics (optional, D6).** Replace the string match on
   `'npm test'` with an explicit `task-verification` catalog action.

What is deliberately *not* changed: a `fail` review still goes through `update-task →
commit → push`, so scope, Git lock, writer-claim and durable-operation safety all still
apply. `implementation` and `human-verification` gates are unchanged.

## Alternatives considered

| Decision | Option | Verdict |
|---|---|---|
| Where to sync | **(b) inside the `commit` stage, before `commit-and-push`** | **Recommended.** Generators are pure and idempotent, so durable stage bookkeeping adds nothing; no change to `FINISH_STAGE_IDS`, record schema, or in-flight records. Retry re-runs sync harmlessly; HEAD-unchanged reconciliation already covers it. |
| | (a) new durable `sync-derived` stage between `update-task` and `commit` | Explicit in records, but changes `FINISH_STAGE_IDS`; `findStage` throws on existing in-flight records lacking it ⇒ migration shim; no recovery benefit because the stage is idempotent anyway. Reconsider only if sync becomes non-idempotent. |
| | (c) separate post-commit "regenerate" commit | Rejected: two commits per operation, HEAD is knowingly stale between them (CI red window), second commit needs its own recovery. |
| | (d) regenerate at `step start` | Rejected: dirties the tree before work begins and trips D13's clean-worktree rule. |
| Generator wiring | **static array registry** | **Recommended.** Matches the existing `defaultGateRegistry`/`defaultActionRegistry` style; one entry per generator. |
| | declarative `derived:` block in workflow YAML | Rejected for now: generators are repository-level, not per-workflow; moves repo ownership into per-workflow config. |
| | event bus / plugin loader | Rejected: no second consumer exists. |
| `when` semantics | **gate-level `when: [results]`** | **Recommended**: smallest schema delta, absent = today's behavior. |
| | per-transition `requires: [gate ids]` | Cleaner model, but a larger schema rewrite of every template/definition and migration of pinned `standard-v1` changes. |
| | engine hardcodes "skip command gates on `fail`" | Rejected: hidden semantics; wrong for other workflows. |
| | disable all gates on `fail` | Rejected by the brief: scope/ownership gates must still apply. |

## Lifecycle and operation sequencing

Logical flow, adjusted to the real transaction boundaries (the brief's model is correct
except that step 3 must run *inside* the Git lock and *before* the commit, after
`update-task` has produced the source mutation the generators read):

```
finish(result)
 1. plan (read-only)            gates filtered by result; --check also previews derived plan
 2. verify-gates   [no lock]    only gates whose `when` matches; red ⇒ replayable block
 ── withGitFinalizeLock ─────────────────────────────────────────────
 3. update-task                 mutate change.yaml (durable intent as today)
 4. sync derived                plan from dirty paths → precondition → generate → check
 5. commit                      explicit set: dirty ∩ (allowed ∪ owned ∪ derivedOwned)
 ── end lock ───────────────────────────────────────────────────────
 6. push, transition            unchanged
```

Cleanliness requirements: tree must be clean (modulo `.nevo-ai-local/**`, `change.yaml`)
at `step start`; it is again clean after a successful `finish`/`publish`/`batch finish`
because sources and their derived outputs land in one commit. `step start`/`--check`
never write derived artifacts.

## Failure, retry and recovery

| Failure | Code | State left behind | Recovery |
|---|---|---|---|
| precondition: foreign dirty input | `DERIVED_INPUT_DIRTY_OUTSIDE_OPERATION` | nothing written; `update-task` completed; `commit` stage `pending` | resolve the dirty file, rerun `finish` (resumes at sync) |
| generator throws (e.g. invalid docs) | `DERIVED_ARTIFACT_SYNC_FAILED` | possibly partial outputs (deterministic, overwritten on retry); `commit` `pending` | fix input, rerun `finish`, or run `specs.mjs generate` / `docs.mjs generate` manually then rerun |
| post-generate check mismatch | `DERIVED_INTEGRITY_FAILED` | as above | rerun; persistent ⇒ generator bug |
| red required gate | `finish` returns `blocked` (gate evidence) | record replayable, `update-task` pending | change `result` or fix and rerun |
| crash between sync and commit | — | outputs on disk, HEAD unchanged | rerun: sync is a no-op diff, commit proceeds (existing HEAD reconciliation) |
| crash after commit, before stage saved | — | HEAD advanced | existing parent+subject reconciliation ⇒ completed; derived files were in that commit |

Sync errors are `WorkflowError` subclasses raised **before** the commit stage writes its
`intent`, so they never produce `unknown`/`reconciliation-required` state. Genuinely
ambiguous commit/`update-task` states keep their current fail-closed handling.

## Compatibility and migration

- Existing in-flight records and pinned definitions keep working: no stage added (option
  b), `when` is optional.
- Tasks that list `docs/index.generated.*` in `allowed_paths` keep working (superset); they
  no longer need to. No mass edit of approved tasks (it would invalidate fingerprints).
- `standard.yaml`/`standard-v1.yaml` `review` changes are a **behavior change** for newly
  finished reviews of pinned `standard-v1` changes (D3).
- D4 option (i) changes the shape of a generated artifact (`index.generated.json`).
- CI is unchanged and remains the backstop: `specs:check` / `docs:check` still fail on any
  stale committed output.

## Owner decisions required

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Boundary | one change/two areas · two changes | one change, two areas; split at approval if preferred |
| D2 | Where sync runs | (a) new durable stage · **(b) inside commit stage** · (c) post-commit | (b) |
| D3 | Behavior change to shipped `standard-v1` `review` (`when: [pass]`, required `fail` feedback) | edit in place · new `standard-v2` · leave definitions, enable via opt-in only | edit in place — v1 is unreleased process tooling in this repo; pin risk limited to in-flight reviews |
| D4 | R2: index projection | (i) drop `workflow_progress` from `index.generated.json` tasks (keep `id/order/file/status/depends_on`) · (ii) keep, rely on sync only · (iii) keep + never include `specs.mjs check` in task verification | (i): mid-step state no longer stales the index; also shrinks diffs. Needs consumer check (task 01) |
| D5 | Integrity scope after sync | own outputs only · plus repo-wide `specs.mjs validate`/`docs.mjs validate` | own outputs only; repo-wide validate remains an explicit/CI check |
| D6 | `task-verification` alias | implement now · defer · document the override only | defer to a follow-up; ship task 08 only if approved |

Also required by `AGENTS.md`: `workflow.mode`/`version` for this change is **not** chosen
here and the manifest deliberately omits `workflow:`.

## Task decomposition

| # | Task | Area | Depends on | Notes |
|---|---|---|---|---|
| 01 | `derived-registry-and-deterministic-generators` | A | — | registry, selective plan, ownership resolver, docs timestamp idempotency, consumer inventory |
| 02 | `finish-derived-sync` | A | 01 | `ensureCommit` hook, scope check, error codes, `--check` preview, settlement ownership |
| 03 | `publish-and-batch-derived-sync` | A | 02 | publish commit set, batch stage 5 |
| 04 | `specs-index-projection-stability` | A | 01 | **only if D4(i) approved** |
| 05 | `transition-aware-exit-gates` | B | — | schema/loader `when`, filtered plan/verify, definitions, required `fail` feedback |
| 06 | `gate-failure-recovery-and-taxonomy` | B | 05 | replayable block, result retarget, `failed` vs `blocked`, settlement, ask_user-timeout finish test |
| 07 | `workflow-documentation-and-adr` | A+B | 02, 03, 06 | `docs/development/workflow-engine.md`, ADR-0011 (next free number) |
| 08 | `explicit-task-verification-action` | B | 05 | **only if D6 approved** |

Areas A and B are independent; 01‖05 can start in parallel. Each task is independently
verifiable (see task files).

## Change-wide acceptance criteria and test plan

All automated under `node --test tools/tests/` unless noted. Fixture repos via
`fixture-repo.test-helper.mjs`.

1. Successful finish updates `change.yaml` **and** triggered indexes in one commit (02).
2. Repeated finish: `already-completed`, no new commit, no diff; repeated sync on a clean
   tree is a byte-for-byte no-op for both generators (01, 02).
3. Generator failure → `DERIVED_ARTIFACT_SYNC_FAILED`, `commit` still `pending`, rerun
   succeeds (02).
4. Crash injected before commit / after commit before stage save resumes without a
   duplicate commit (02).
5. `allowed_paths` strictly enforced; an out-of-scope dirty file still fails (02).
6. Derived outputs accepted only as exact paths of generators that ran; a *non*-triggered
   generated file left dirty is rejected (02).
7. Unrelated dirty file (including a foreign `change.yaml`) is not staged and fails the
   precondition (02).
8. `step start` after `finish` never hits a dirty-worktree deadlock; `step start`/`--check`
   write no derived file (02).
9. Editing `docs/**` triggers only `docsIndexes`; editing `change.yaml` triggers only
   `specsIndexes` (01, 02).
10. `review pass` blocked by red verification; `review fail` succeeds with red tests and
    records `feedback` (05).
11. Red-gate block is replayable: `result` can be switched `pass → fail`; settlement says
    `resumable` (06).
12. Repo-integrity failure (`DERIVED_INTEGRITY_FAILED`) is distinguishable from gate
    `failed` and from `blocked` runner error (02, 06).
13. Same behavior through CLI `finish`, human-step `finishStep` and `batch finish` (03, 05, 06).
14. CI check still fails on a committed stale index (existing REC-03 test kept green; one
    new test asserts check fails when sync is skipped).
15. After `ask_user` timeout/expiry the reviewer can still submit `fail` + feedback via
    `finish --input` (06).

## Out of scope / deferred follow-ups

- Resolving the ADR-0009/0010 number collision and PR #53's immediate index regeneration
  (separate maintenance concerns, per the brief).
- Migrating legacy `approve`/`verify`/`finalize`/`self-check`/create to the shared sync
  call (cleanup once 02 lands).
- Repo-wide validation as a post-sync gate (D5).
- Recording failed-check output as non-blocking evidence on `fail` reviews.
- A `docs.mjs validate` rule rejecting duplicate ADR numbers (already a recorded follow-up).
- Scope enforcement for the batch shared commit (observed unconstrained; separate finding).
- Any change to `ai-spec-history`'s execution state.

## ADR impact

One new ADR (task 07): "Workflow-owned derived artifacts and transition-aware exit
gates". Does not supersede an existing ADR.

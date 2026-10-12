# Owner decisions — exit-gate-improvements

## D1: Change boundary

- **Question:** One change with two independent areas, or two separate changes?
- **Options considered:** one change / two areas | two changes
- **Decision:** One change, two areas (A: derived-artifact ownership, B: transition-aware gates).
- **Consequences:** Single branch and review; areas stay independently implementable and may still be split later.
- **Date:** 2026-10-10
- **Affected artifacts:** `overview.md`, `areas/*.md`

## D2: Where derived-artifact sync runs in finish

- **Question:** Where in the finish transaction are generated artifacts regenerated?
- **Options considered:** (a) new durable `sync-derived` stage | (b) a step inside the existing `commit` stage, before `commit-and-push` | (c) a second commit after the main commit
- **Decision:** (b). Owner asked for clarification first; decided after the explanation that user-visible usage is unchanged.
- **Rationale:** Smallest change; no record-schema change or migration of in-flight records; generators are idempotent so re-running on resume is safe.
- **Consequences:** `FINISH_STAGE_IDS` unchanged; sync errors must be raised before the commit stage writes its `intent`.
- **Date:** 2026-10-10
- **Affected artifacts:** `tasks/02-finish-derived-sync.md`, `tasks/03-publish-and-batch-derived-sync.md`

## D3: Behavior change to shipped `standard-v1`

- **Question:** How to ship `when: [pass]` on the review command gate and required `fail` feedback?
- **Options considered:** edit `standard-v1` in place | new `standard-v2` | opt-in only
- **Decision:** Edit `standard-v1` in place.
- **Consequences:** Reviews finished after the change use the new semantics for pinned `standard-v1` changes.
- **Date:** 2026-10-10
- **Affected artifacts:** `tasks/05-transition-aware-exit-gates.md`, `tasks/06-gate-failure-recovery-and-taxonomy.md`

## D4: Specs index projection

- **Question:** Keep `workflow_progress` in `specs/index.generated.json` task entries?
- **Options considered:** (i) drop it | (ii) keep, rely on sync only | (iii) keep, forbid `specs.mjs check` in task Verification
- **Decision:** (i) drop `workflow_progress` (keep `id`, `order`, `file`, `status`, `depends_on`).
- **Consequences:** Task 04 is unconditional; task 01 must inventory consumers of `tasks[].workflow_progress` first.
- **Date:** 2026-10-10
- **Affected artifacts:** `tasks/01-*.md`, `tasks/04-specs-index-projection-stability.md`

## D5: Integrity scope after sync

- **Question:** What is validated after generation, before commit?
- **Options considered:** own generator outputs only | own outputs plus repo-wide `specs.mjs validate` / `docs.mjs validate`
- **Decision:** Own outputs plus repo-wide specs and docs validation (owner chose the stricter option over the recommendation).
- **Rationale:** Do not commit a repository state that fails CI.
- **Consequences:** An unrelated validation error elsewhere blocks every finish until fixed; reported as the distinct `REPO_INTEGRITY_FAILED` code, never as a review outcome.
- **Re-evaluation note (2026-10-11):** Under D5, an unrelated validation error anywhere in the repository blocks all finish operations, including `review fail` (which commits under `ensureCommit`). This recreates the blocking problem that motivated Area B by preventing reviewers from recording negative evidence. Options considered: (1) maintain D5 as unconditional repo-wide validation (preserves strict CI guarantee at the expense of task autonomy); (2) scoped validation bypassing repo-wide checks on rework (`fail`) transitions; (3) change-scoped validation. Per decision policy, D5 remains accepted as decided unless explicitly modified by the owner.
- **Date:** 2026-10-10
- **Affected artifacts:** `tasks/02-finish-derived-sync.md`

## D6: Task verification semantics

- **Question:** Keep the runtime substitution of `npm test` by the task's `## Verification` commands, or make it explicit?
- **Options considered:** implement an explicit action now | defer | only document the override
- **Decision:** Implement now. Owner: such hidden behavior must not exist; all behavior must be declared in config.
- **Rationale:** The `test` alias currently means different things in the catalog and at runtime (string match in `runCliCommandWithLiveOutput`).
- **Consequences:** Task 08 stays and is unconditional: new `task-verification` action, `test` means literal `npm test`, string match removed, workflow definitions migrated in the same task.
- **Date:** 2026-10-10
- **Affected artifacts:** `tasks/08-explicit-task-verification-action.md`, `tasks/07-workflow-documentation-and-adr.md`

## D7: Workflow mode

- **Question:** `workflow.mode` for this change (owner-only choice per `AGENTS.md`).
- **Decision:** `legacy`. The manifest omits `workflow:`, which resolves to the default legacy mode.
- **Date:** 2026-10-10
- **Affected artifacts:** `change.yaml`

## D8: Slug

- **Question:** Rename the misspelled slug `exit-gate-imorovements`?
- **Decision:** Rename to `exit-gate-improvements` before approval.
- **Consequences:** Folder, ids, paths and branch name use the corrected slug.
- **Date:** 2026-10-10
- **Affected artifacts:** all artifacts

---
id: adr.0006-process-continuity-and-hardening
type: adr
title: Process continuity and hardening — suspension-based recovery, derived batch state, tiered fingerprints, and verify-before-destructive-cleanup finalization
status: accepted
date: 2026-08-05
supersedes: ~
superseded_by: ~
---

# ADR-0006: Process continuity and hardening

## Status

Accepted

## Context

The workflow ADR-0005 hardened (deterministic approval, a real state machine, a
whole-spec fingerprint) still had real gaps once used across longer, interrupted, or
multi-task sessions:

1. **No recovery model.** Every failure in `tools/specs.mjs` was an uncaught or
   `CliError` exception caught once at the top level — no classification, no retry
   target, nothing persisted about *why* an action stopped or what to do next. A
   resumed session had to re-diagnose from scratch every time.
2. **A single whole-spec fingerprint over-invalidated.** `computeSpecFingerprint`
   hashed the entire change directory — `change.yaml` included — so a bare task-status
   write invalidated the stored review's fingerprint for every other task in the same
   change, forcing an unnecessary re-review.
3. **No batch mode.** Every task ran through one interactive turn per transition, even
   for a long, low-risk, mechanically-derivable dependency chain — there was no way to
   express "run every approved task this graph makes reachable, with one gating review
   at the end" without N single-task round trips.
4. **No structured follow-up mechanism.** A `NON_BLOCKING` review finding lived only in
   that run's report — nothing tracked whether it was ever acted on.
5. **The merge sequence deleted the branch in the same call as the squash-merge**, so a
   post-merge regression had no diagnostic branch left to investigate from, and a
   would-be fix had nowhere to attach a follow-up record (the change was already
   archived).
6. **No task type could skip the review-file requirement**, even for a small,
   deterministic, already-approved-pattern derivative task (e.g. a mechanical resolver
   generated from an already-reviewed task) — every task paid the same review cost
   regardless of actual risk.

This change (`nevo-ai-process-continuity-and-hardening`) addresses all six as one
related set of process-continuity mechanisms, built and landed as eleven ordered tasks
(01–11), each proven by its own test suite and, cumulatively, by task 10's
cross-mechanism end-to-end suite before this documentation task ran.

A twelfth task, `implementation-review-orchestration` (D30), was added after tasks 01–11
already shipped: real usage surfaced a seventh gap the original six didn't cover — no way
to review an owner-selected range or list of already-implemented tasks together, each at
`task-review`'s own depth, with one cross-task integration pass and one bulk status
decision, short of either N single-task `task-review` round trips or the deliberately
non-gating `spec-audit`. See "Multi-task implementation review orchestration (D30)"
below.

A thirteenth task, `review-report-compaction-and-scope-exceptions` (D31), was added
after task 12 reached `status: in-implementation`: task 12's own review shape (and the
pre-existing `task-review`/`spec-audit`/gating-batch-review shapes it reuses) narrates
every passing check in prose, expensive once `/nevo-ai:implementation-review` starts
aggregating several tasks at once; separately, `task-review.md`'s "a scope violation is
always blocking, no exceptions" wording gave a legitimate, owner-accepted narrow
violation no path to `pass` short of a full spec amendment. See "Review report
compaction and owner-approved scope exceptions (D31)" below.

After all thirteen tasks reached `verified`, a seventh refinement pass recorded a
ten-property one-person-workflow bar (D34) and added eight further tasks (14–21, D35)
closing gaps a reconciliation pass had already surfaced against it. A fourteenth task,
`review-report-minimization`, tightens task 13's own "15-30 line" target for a normal
passing `task-review`/`implementation-review` report into a deterministically enforced
10-line ceiling. See "Report minimization (D34, D35)" below.

A fifteenth task, `deterministic-implementation-provenance`, closes the scope D33
explicitly deferred: a persisted, per-task `implementation` block
(`baseline_revision`/`review_revision`/`changed_paths`/`worktree_patch_fingerprint`) so
task ownership of a changed file is a stored, attributed fact rather than re-inferred
from `git diff`, commit messages, or `allowed_paths` pattern-matching every time it's
needed — closing `computeImplementationFingerprint`'s own long-standing "populating real
revision/evidence data is later tasks' job" gap. See "Implementation provenance and
attribution (D34, D35)" below.

A sixteenth task, `semantic-cross-task-integration-and-consolidated-decisions`, extends
task 12's cross-task integration pass beyond literal file-path overlap into a bounded
semantic pass over pairs sharing a dependency contract or owner decision, completes the
per-task structured record `implementation-review` carries into its aggregate step
(pending owner/scope decisions, clarification requests, follow-up candidates, and the
implementation fingerprint, task 15), and collapses owner/scope decisions, follow-up
choices, and the bulk-transition confirmation into one consolidated stage — no per-task
prompt of any kind, including task 12's own step-7a follow-up offer, which this task
suppresses specifically inside `implementation-review`'s orchestration. See "Semantic
cross-task integration and consolidated decisions (D34, D35)" below.

A seventeenth task, `scoped-and-incremental-spec-review`, adds
`/nevo-ai:spec-review <change-id> --all|--changed|--tasks <spec>` — `--all` (also the
default, unchanged for full compatibility) reviews every task; `--changed` reviews only
new or semantically changed tasks; `--tasks` reviews an explicit order range/list.
Context reading and review scope are kept structurally separate — reading an
already-reviewed task for background never re-grades it — and a scoped review cannot
claim whole-change readiness unless every out-of-scope task (from task 12 onward) still
retains a fingerprint matching its last review. See "Scoped and incremental spec-review
(D34, D35)" below.

An eighteenth task, `compound-actions-and-dependency-aware-status`, closes two
previously-tracked follow-ups: `spec-approve`'s "approve and start" outcome now
continues directly into implementation after `start` succeeds, in the same turn, with no
further ask (FU-002); and `deriveStage`'s `ready-to-start` stage now checks
`depsSatisfied` before reporting a task ready, falling through to the real blocking
task's own stage or an explicit `blocked-on-dependencies` report (FU-004). See "Complete
owner-facing compound actions and dependency-aware status (D34, D35)" below.

A nineteenth task, `unowned-drift-correction-flow`, adds a named, classified process —
**unowned-drift** — for a real correction outside every current task's own scope,
closing FU-006 (hit twice in this repository's own history as an undocumented ad hoc
edit). `classifyUnownedDrift` distinguishes `owned`/`forbidden`/`unowned-drift`; a
classified `unowned-drift` path is presented a three-option owner menu (a narrow
corrective task, amending an existing task's scope, or an explicit owner-authorized
maintenance correction); the third option persists a structured `follow-ups.yaml`
record (`validateMaintenanceCorrectionEntry`), never a silent edit. See "Formal
unowned-drift correction flow (D34, D35)" below.

A twentieth task, `repository-bound-handler-testability`, parameterizes
`handleStart`/`checkSpecsIndexes`/`buildSpecsIndexes`'s repository-root paths —
optional parameters defaulting to the real repository, closing FU-007 (`handleStart`
"reads the real repository's `ACTIVE_DIR`... and can't be driven end-to-end in a
fixture test," worked around twice already). A reusable `createFixtureRepo` helper
builds a throwaway git repository plus a minimal `specs/active/` tree, so `start`,
index staleness (REC-03), `execution.suspension`, and dependency-aware `status` (task
18) all get real, fixture-backed end-to-end coverage without ever touching the real
checkout. See "Repository-bound handler testability (D34, D35)" below.

A twenty-first, final task, `owner-workflow-acceptance-scenarios`, validates D34's whole
ten-property bar end-to-end across tasks 14-20's own mechanisms, composed — fifteen
required regression scenarios (approve+start begins work without a further ask; a
passing review renders minimally; a failing review expands only what failed; bounded
per-task context; no owner questions between task reviews; a real semantic contract
mismatch is detected; path overlap alone stays non-blocking; independent per-task
provenance on a shared file; a scoped review never re-grades old tasks; dependency-aware
status never proposes an unstartable task; unowned drift follows the named process; an
accepted scope exception stays narrow; `HEAD` advancement never stales earlier evidence;
an aggregate report can never contradict its own canonical per-task reports; and the
composite scenario — only the initial request, genuine owner decisions, and one final
confirmation), driven against fixture repositories (task 20), never the real one, and
test-only (no production code in its own `allowed_paths`). See "Owner-workflow
acceptance scenarios (D34, D35)" below.

## Decision

### State model and fingerprints (D1, D6, D7, D16, D18, D27)

1. **`execution.suspension`, not new lifecycle statuses (D8).** A task's stable `status`
   (`draft`/.../terminal) never encodes *why the last action stopped* — that lives in an
   orthogonal, optional `execution.suspension` block (`kind`/`code`/`previous_action`/
   `created_at`). `blocked`/`needs-decision` are removed from the status vocabulary
   entirely (D16, not just left valid-but-unreachable) — `tools/specs.mjs validate`
   rejects either with a fixed migration message.
2. **A three-tier semantic fingerprint replaces the single whole-spec hash (D7)** —
   `computeChangeFingerprint` (change scope: `overview.md` + the task graph's shape),
   `computeTaskFingerprint` (one task's own content, paths, and resolved
   `semantic_references`), `computeImplementationFingerprint` (task fingerprint +
   revision + evidence). Each excludes `status`/`execution.suspension`/`self_check` by
   construction — a canonical semantic projection, not a whole-file hash with an
   exclusion list. Adding or removing a task always invalidates
   `computeChangeFingerprint`; an unrelated task's own fingerprint is unaffected unless
   its `semantic_references.dependency_contracts` names the added/removed task (D27,
   corrected from an earlier draft that had this backwards).
3. **`semantic_references` (D18)** makes a task's fingerprint scope deterministic
   instead of prose-inferred: `decisions`/`constraints`/`dependency_contracts`,
   integrity-checked by `validateSpecs` (every `dependency_contracts` entry is in the
   task's own `depends_on`; every `decisions`/`constraints` entry resolves and isn't
   superseded). *Completeness* — whether the list covers everything the task's content
   actually depends on — is a separate model-review concern (D26, below), never
   something schema validation alone can prove.

### Recovery and resume (D2, D3, D4, D8, D17)

4. **A canonical nine-scenario recovery catalog (`REC-01`..`REC-09`)**, each with a
   fixed class (`automatic`/`confirm-required`/`owner-decision`/`unsafe-manual`),
   proposed recovery, and retry target. Every state-changing action's postcondition
   inspection reports one of five results — `completed`/`safe_to_retry`/
   `partially_completed`/`not_retryable`/`unsafe_manual` — never a bare boolean.
   Recovery always inspects real state and executes only the missing effects.
5. **A `confirm-required` stop inside an authorized combined transition resumes in
   place after one confirmation (D17)**, rather than ending the flow and requiring a
   second command invocation — the resumable recovery handle is the same
   postcondition-inspection function, re-invoked over fresh state. A confirmation is
   asked at most once per repair.
6. **`spec-approve`'s fourth outcome, "approve and start" (D3)**, is the one place a
   single owner confirmation runs two underlying transitions in sequence — `approve`
   then `start`, re-checked against current state, never combined into one operation,
   never rolling back a successful `approve` when `start` then fails.
7. **An authorized scope** (a single task, or one of D20's four batch-selection modes)
   bounds how far the controller may continue automatically — it stops immediately at
   scope expansion, an `unsafe_manual` result, unrelated dirty files, a `not_retryable`
   result, a failed acceptance criterion, unresolved high-risk evidence, stale
   unresolved batch evidence, or the end of the scope, never past it.

### Batch execution and gating review (D10, D11, D19, D20, D21, D24, D28)

8. **Batch selection is one of four named modes, no default (D20)** —
   `currently-ready` / `all-approved-reachable` / `named-subset` / `until-checkpoint` —
   dispatched from a single function, never four independent code paths.
   `all-approved-reachable` is what makes "run every approved task this graph makes
   reachable" expressible for a linear dependency chain, which `currently-ready` alone
   could only ever select the first task of.
9. **Batch progress is derived, never persisted twice (D10).** The batch-intent file
   holds only intent (`change`/`requestedTasks`/`orderedTasks`/`startRevision`/
   `reviewMode`/`checkpointPolicy`/`temporaryInconsistencies`); `deriveBatchProgress`
   reconstructs completed/current/next/failed from `change.yaml` every time it's
   needed — nothing to reconcile after an interrupted write.
10. **Hard stop conditions are checked before, and are never substitutable by, a
    full-review risk signal (D24).** A failed/unresolved self-check, a failed
    acceptance criterion, failed automated verification, or unrefreshable stale
    evidence halt a batch immediately; a full `task-review` is never offered as an
    alternative path around one. Only once a hard stop clears do evidence-based risk
    signals (D11 — declared review-required, public-API/security/migration impact, an
    `owner-decision:`-tagged criterion, scope expansion, unexpected files,
    implementation divergence, an owner-flagged high-risk task) decide whether a full
    `task-review` is additionally required. Touching `src/**`/`tests/**`/
    `consequential_paths` alone is never a signal by itself.
11. **`self_check` is a persisted, single-write-path block (D28)** — `status`, the
    task's semantic fingerprint/revision at run time, `failed_criteria`, and each
    command's exit code. `deriveStage` reads it back (read-only) to report one of four
    states: not-run, failed, passed-and-fresh, passed-but-stale (fingerprint/revision
    no longer match — triggers a rerun).
12. **Evidence freshness is checked immediately before the gating batch review, as its
    own step (D19)** — a later-batched task's file/path overlap with an earlier task's
    recorded evidence, or a fingerprint mismatch (D28's "passed but stale"), stales
    that evidence and blocks the review until refreshed; unrefreshable stale evidence
    is itself a hard stop, never a caveat the review proceeds past.
13. **The gating batch review never re-evaluates any individual task's own acceptance
    criteria** — only the whole-batch diff, cross-task integration, and open
    `blocking`-severity `follow-ups.yaml` entries, verdict computed from an explicit
    table (same shape as a change-wide audit's).
14. **Task 08 depends on task 06 (D21)** — the gating review reads the follow-up
    ledger task 06 introduces.

### Context, scope, and validation hardening (D12, D13, D14, D15, D22, D26, D29)

15. **A validated, machine-readable routing contract (D12)** — `task-routing.md`/
    `change-impact-map.md` gain a `rule_id | path_glob | doc_ref` table;
    `docs/routing.generated.json` is the only thing the context-completeness check
    reads at check time, never the source prose. A declared `context.required`/
    `optional` entry always wins over a routing suggestion; a suggestion only adds
    gap-check candidates.
16. **`context_exceptions` requires a recorded owner-decision reference (D13)** and
    participates in the task-level fingerprint.
17. **`consequential_paths` (unchanged from the original draft)** — direct, mechanical,
    generated-or-reference-only consequences of a task's primary scope; a write there
    is never a scope violation, but must never overlap `forbidden_paths`.
18. **The follow-up ledger is mutable, structured YAML, not append-only prose (D15,
    D22)** — `follow-ups.yaml`, one entry mutated in place on resolve/dismiss, never
    duplicated. Dismissing a `blocking` entry requires a recorded owner decision.
19. **`type: mechanical` is review-exempt deterministic approval, not auto-approval
    (D14)** — `approve` still performs the same explicit, auditable transition; only
    the review-file/fingerprint requirement is skipped, and only when all six
    conjunctive conditions hold (derived from an already-approved task, deterministic,
    no public behavior change, no new design decision, paths already declared on the
    deriving task, every acceptance criterion `automated:`-tagged). Any failing
    condition falls back to the normal cycle, fails closed, never silently blocked or
    silently approved.
20. **Reference integrity vs. completeness are distinct checks (D26)** — integrity is
    deterministic (`validateSpecs`); completeness (does the declared list cover
    everything the task's content actually depends on) is a model-review step inside
    `/nevo-ai:spec-review`, since schema validation cannot detect an omission.
21. **A missing, load-bearing reference is never `NON_BLOCKING` (D29)** —
    `AUTO_FIX` when unambiguous, `OWNER_DECISION` when ambiguous; `NON_BLOCKING` is
    reserved for an unnecessary (not missing) reference. An unresolved missing-reference
    finding blocks `ready-for-approval`.

### Finalization hardening (D9, D23, D25)

22. **Verify before destructive cleanup (D9).** `finalize`'s merge step no longer
    deletes the branch in the same call as the squash-merge (`gh pr merge --squash`,
    no `--delete-branch`). After merging: fetch, fast-forward local `main`, run the
    cheap post-merge check (`specs.mjs`/`docs.mjs` `check` only — no duplicate `dotnet
    build`/`dotnet test`), and only on a pass delete the branch. On failure: report the
    merged SHA, the failed check, and preserve the branch — write no `follow-ups.yaml`
    entry into the now-archived change, since that would mutate an already-finalized
    artifact with no commit path.
23. **The preserved branch is a diagnostic anchor, not a recovery mechanism (D23)** — it
    doesn't itself repair `main`. A guarded, confirm-then-create repair-branch step
    (`fix/<change>-post-merge`) is offered after one explicit confirmation.
24. **The repair-branch guard sequence is nine ordered, read-before-write steps (D25)**
    — every read-only/remote check (worktree clean, local/remote branch absence,
    `origin/main` still at the recorded failing SHA) completes before switching or
    fast-forwarding local `main`; only then is the post-fast-forward SHA checked, and
    only then is the branch created. A guard failing before the `main` switch reports
    at most a completed read-only fetch; a guard failing after it states precisely
    that the switch/fast-forward already happened — Git provides no atomic rollback
    across those steps, so the report must never claim "nothing was modified" when
    something was. Never `reset`/`clean`/force-checkout/automatic-stash at any step.

### Multi-task implementation review orchestration (D30)

25. **`/nevo-ai:implementation-review <change-id> --all|--tasks <range-or-list>`** is a
    fifth, distinct review shape alongside task review, spec review, change-wide audits,
    and the gating batch review — none of which fit "review a selected range/list of
    already-implemented tasks together, then decide what's safe to mark verified."
    `--tasks` selects by each task's own `order` field (a dash range like `01-03`, or a
    comma list like `01,03,07`), resolved deterministically by `node tools/specs.mjs review-scope`, never agent-parsed.
26. **The per-task review depth is `task-review`'s own flow, reused verbatim, not
    reimplemented.** For each task in the resolved scope, sequentially: run
    `task-review`'s own steps 1-8 (context, baseline, diff, path checks, acceptance-
    criteria/area/constraint/ADR comparison, finding classification) — never its status-
    decision step. In Claude Code, each task's review runs in a fresh subagent invocation
    so a completed task's full diff/file reads never remain loaded while the next task's
    review runs — only its finished review artifact and a compact summary do.
27. **One cross-task integration pass, once, reusing the gating batch review's own
    diff-attribution/integration-finding functions** (`attributeTouchedPaths`/
    `detectBatchIntegrationFindings`, D19/D24) rather than a second implementation of the
    same mechanism — never re-evaluating any individual task's own acceptance criteria.
28. **The overall verdict is a fourth vocabulary** — `pass` \| `changes-required` \|
    `owner-decision-required` \| `blocked` — computed by `computeMultiTaskReviewVerdict`
    from an explicit table, the same convention as every other verdict in this workflow;
    distinct from `task-review`'s own three-value per-task verdict, which this
    orchestration reuses unchanged for each individual task.
29. **Exactly one bulk status confirmation, only over the eligible subset.** A task is
    eligible only when its own verdict is `pass` **and** it carries zero unresolved
    blocking findings at either the per-task or the cross-task level
    (`selectEligibleForVerification`) — every other reviewed task must remain unchanged,
    regardless of which of the three closed-menu options (verified /
    implemented-self-verified / leave unchanged) the owner picks.
30. **The confirmed transition is applied through one atomic bulk CLI operation
    (`node tools/specs.mjs bulk-transition`), never one status write per task.**
    `computeBulkTransitionTarget`/`validateBulkTransition` compute and validate every
    named task's transition — including the same hard-stop check `complete` already
    performs standalone for a task hopping through `implemented` — *before* anything is
    written; the write itself is exactly one `change.yaml` read-modify-write covering
    every eligible task together. An invalid computed transition for any one task
    rejects the whole operation, naming it — all-or-nothing, never best-effort.
31. **`task-review` and `spec-audit` are unchanged** — this orchestrates the former's
    own depth across a range; it does not fold it in or duplicate the latter's
    thematic, non-gating shape.

### Review report compaction and owner-approved scope exceptions (D31)

32. **A seven-item compact checklist replaces verbose positive-proof prose** in
    `task-review`/`implementation-review` reports (`spec-review`/`spec-audit`/the
    gating batch review are unchanged) — computed by `computeTaskReviewChecklist`
    (`tools/specs/lifecycle.mjs`), never composed as prose. A checked item carries no
    further prose; a failed item names the specific acceptance criterion, finding, or
    scope issue beneath it. `Findings` is restricted to actionable/exception content —
    never a synthetic `INFORMATIONAL` row for a passing check, since that fact is
    already the checked checklist item. A normal passing report lands around 15-30
    lines as a consequence, not a truncation target.
33. **"No unresolved or unrecorded scope exception may pass" replaces "a scope
    violation is always blocking, no exceptions."** Every touched path outside a
    task's own scope is classified by `classifyScopeFinding` (`tools/specs/lifecycle.mjs`,
    reusing `pathMatchesAllowedPattern`) as `compliant` / `outside-allowed` /
    `forbidden`. An `outside-allowed` finding may be resolved by an explicit owner
    decision — accept (`scope_exceptions` entry, one concrete path + one finding ID +
    task fingerprint, never a glob), require a return to declared scope, or leave
    unresolved. A `forbidden` finding is **categorically excluded** from this
    mechanism — only reverting/re-attributing the change, or a specification scope
    amendment editing the task's own `allowed_paths`/`forbidden_paths` (D18's existing
    fingerprint-invalidation mechanism, no new logic), resolves it.
34. **A new finding-lifecycle value, `accepted`**, alongside the existing
    `resolved`/`still-present`/`changed`/`cannot-verify` set — excluded from the
    unresolved-blocking count feeding the verdict, but the finding's row and the
    checklist's "Scope check resolved" item must still state, every time the report is
    written, that the implementation exceeded its declared scope. The finding is never
    deleted, only re-validated on the next re-review.
35. **Exception validity across re-review splits deterministic from model-judged.**
    `isScopeExceptionValid` (`tools/specs/lifecycle.mjs`) deterministically checks the
    same concrete path and the task's current semantic fingerprint (D18,
    `computeTaskFingerprint`) against what was recorded at acceptance — a mismatch
    invalidates the exception outright. Whether the out-of-scope change has *materially
    expanded* beyond that is a model-inspection step at re-review time the deterministic
    check cannot decide; a re-review finding material expansion re-opens the finding for
    a fresh owner decision even when the fingerprint check alone would have passed.
36. **`implementation-review`'s aggregate report becomes one compact row per task**
    (`Task | Verdict | AC | Tests | Scope | Findings`, `Scope` one of `compliant` /
    `exception pending` / `N owner-approved exception(s)` / `forbidden-path
    violation`) instead of several concatenated full per-task reports — expanded only
    for failing/exception/cross-task/owner-decision tasks. Several selected tasks'
    scope-exception decisions are collected into one owner-facing confirmation, grouped
    by `outside-allowed` (eligible for the acceptance menu) versus `forbidden` (never
    eligible) — never folded into one accept-all answer — applied atomically through
    task 12's existing `bulk-transition` operation, never a second write path, and never
    touching a task with any other still-unresolved finding.
37. **The three-value per-task verdict set is unchanged** — `pass` / `changes-required`
    / `blocked`, no fourth value for a pending scope-exception decision. An unresolved
    scope-exception decision is an unresolved `OWNER_DECISION` finding, which already
    routes a task to `changes-required` under the existing table; the aggregate table's
    `Scope` column, not the `Verdict` column, is where "exception pending" is surfaced.
    `--verbose` (restoring full AC-by-AC prose) is an optional, additive interface this
    task may ship without, per its own scope.

### Report minimization (D34, D35)

38. **A normal passing `task-review`/`implementation-review` report has at most 10
    non-empty lines**, tightening D31's "15-30 lines as a consequence" figure into a
    deterministically enforced ceiling: title line, the seven checklist items
    (`renderCompactReviewChecklist`), plus, when an owner-approved scope exception is
    active, one exception-note line (`renderNormalPassingReportBody`, both in
    `tools/specs/lifecycle.mjs`). Applies only to the fully-passing case — no unresolved
    finding, no unresolved owner/scope decision; a report with any of those keeps D31's
    expanded shape.
39. **A structural guard, not just a shorter template.** `checkReportSectionUniqueness`
    (`tools/specs/lifecycle.mjs`) confirms AC coverage, scope, and findings each appear
    at most once in a rendered report body — a second heading restating a checklist item
    is a defect this function catches, not a style preference.
40. **The same renderer serves both `task-review` and `implementation-review`.**
    `implementation-review`'s per-task loop reuses `task-review.md` step 8 verbatim
    (task 12), so a passing task's own `reviews/<task-id>.md` already goes through
    `renderNormalPassingReportBody` — no second, divergent minimal-report renderer for
    the orchestrated case.

### Implementation provenance and attribution (D34, D35)

41. **A persisted, per-task `implementation` block** —
    `baseline_revision`/`review_revision`/`changed_paths`/`worktree_patch_fingerprint` —
    closes the scope D33 explicitly deferred ("a narrower, correct revision-based
    check... as a genuinely new predicate... explicitly named as future work"). Task
    ownership of a changed file becomes a stored fact instead of being re-inferred from
    `git diff`, commit messages, or `allowed_paths` pattern-matching every time it's
    needed.
42. **`baseline_revision` is recorded exactly once**, on a task's first successful
    `start` (`nextImplementationBaseline`, `tools/specs/lifecycle.mjs`) — a later
    `safe_to_retry`/idempotent `start` never overwrites it, mirroring how `self_check`
    (D28) and `execution.suspension` (D8) are each written by exactly one path.
43. **`changed_paths` is attributed, not merely collected** —
    `computeTaskAttributedChangedPaths` filters a raw changed-file list (committed since
    baseline, plus still-uncommitted/untracked — `git.getChangedFiles`'s own existing
    union) down to only the paths matching this task's own `allowed_paths`, refreshed
    alongside `self_check` on every `self-check` run. Two sequential tasks touching the
    same file each retain their own independent, correct attribution — task B editing a
    file never rewrites task A's already-persisted record.
44. **`computeImplementationFingerprint` is finally populated with real data.** The
    function itself (defined by task 01) is unchanged; a new
    `computeImplementationFingerprintFromProvenance` reads a task's own persisted
    `implementation` block as the `revision`/`evidence` inputs, closing the gap the
    function's own original doc comment named ("populating real revision/evidence data
    is later tasks' job").
45. **`implementation` is excluded from every fingerprint tier** — operational evidence,
    not semantic task content, exactly like `status`/`execution.suspension`/
    `self_check`.
46. **Owner-confirmed migration flow, never unattended.** `suggest-provenance` (read-only
    — inspects commit messages mentioning the task id as a *suggestion*, never
    authoritative) and `apply-provenance --confirm --baseline <sha>` (the only write
    path, refuses to write without an explicit `--confirm`) let an already-terminal task
    (01-13) gain a reconstructed `implementation` block on request — never run
    unattended against them as part of shipping this task, mirroring D32's precedent
    that a new completeness mechanism is not silently enforced backward against
    already-closed work.
47. **Does not reopen D33.** `self_check.revision`/`staleEvidenceTasks` are unchanged —
    this is a separate, narrower mechanism answering "what did this task's own work
    touch," not a reversal of D33's "never compare against global `HEAD` equality" rule.

### Semantic cross-task integration and consolidated decisions (D34, D35)

48. **Bounded pair selection, not every pair in scope.** `selectSemanticIntegrationPairs`
    (`tools/specs/lifecycle.mjs`) selects a pair for semantic inspection when it already
    shares a file-overlap finding, or when the two tasks' `semantic_references` name each
    other (`dependency_contracts`) or share a decision — a real relationship the
    file-overlap check alone cannot see. Path overlap alone remains a review candidate,
    never an automatic defect, unchanged from task 12's own original rule.
49. **Eleven signal categories, model-inspected over the selected pairs** — dependency
    contracts, semantic references, public CLI changes, shared schemas/state, lifecycle
    transitions, producer/consumer relationships, error/recovery contracts, guard/
    side-effect ordering, documentation contracts, consequential paths, and shared files.
    A finding exists only for a real inconsistency — never a synthetic record that a pair
    was checked and found clean, same split this workflow already uses for
    semantic-reference completeness (D26).
50. **The per-task structured record is complete.** `PER_TASK_REVIEW_FIELDS`
    (`tools/specs/lifecycle.mjs`) names every field the owner's requirement listed —
    task ID, verdict, AC covered/total, scope status, blocking findings, pending owner
    decisions, pending scope decisions, clarification requests, follow-up candidates,
    review artifact, and implementation fingerprint (task 15) — validated by
    `validatePerTaskReviewRecord` before it leaves a per-task subagent's context.
51. **One consolidated stage, not a scope-decision turn followed by a status turn.**
    `buildConsolidatedDecisionStage` collects every reviewed task's pending owner/scope
    decisions and follow-up candidates; `implementation-review.md` presents them
    together, in one turn, before the bulk-transition confirmation (itself unchanged from
    task 12's own eligibility rule and single write path).
52. **Task 12's own step-7a follow-up offer is suppressed, but only inside this
    orchestration.** A per-task run happening *through* `implementation-review` collects
    a would-be follow-up candidate into the consolidated stage instead of asking inline;
    `/nevo-ai:task-review` run standalone is unaffected — its own step 7a offer is
    unchanged, still presented per task, exactly as task 12 originally shipped it.

### Scoped and incremental spec-review (D34, D35)

53. **`--all`/`--changed`/`--tasks` — `--all` is also the default**, so every existing
    invocation of `/nevo-ai:spec-review <change-id>` continues to work unchanged.
    `--changed` (`selectChangedTaskIds`) selects tasks whose current
    `computeTaskFingerprint` doesn't match the prior review's `task_fingerprints` entry,
    or that have no entry at all. `--tasks` reuses the same order-range/order-list
    grammar `/nevo-ai:implementation-review`'s `review-scope` already established, rather
    than a second parser.
54. **Context reading and review scope are structurally separate.** Reading an
    already-reviewed task's file for background never re-grades it, never regenerates
    its verdict, never replaces its `task_fingerprints` entry, and never changes its
    `status` — only the deterministic report write persists those fields, and only for
    tasks in the resolved scope.
55. **A scoped review names a potentially-impacted out-of-scope task, never silently
    re-reviews or ignores it.** `findPotentiallyImpactedOutOfScopeTasks` reports an
    out-of-scope task named in a selected task's own `dependency_contracts`, offering
    scope expansion rather than deciding on the owner's behalf.
56. **A scoped review cannot claim whole-change readiness on a stale out-of-scope
    baseline.** `scopedReviewBaselineValid` gates rows 4-5 of the spec-review decision
    table for any non-`--all` run — every out-of-scope task from task 12 onward must
    still have a fingerprint matching its last review, or the verdict reports the
    invalidated task(s) and recommends scope expansion instead.
57. **The same compact shape task 14 already defines**, adapted to `spec-review`'s own
    five-value verdict vocabulary (`renderScopedSpecReviewBody`) — only for the new
    scoped modes; `--all`'s existing report shape is unchanged.

### Complete owner-facing compound actions and dependency-aware status (D34, D35)

58. **"Approve and start implementation" completes the whole operation its label
    promises, closing FU-002.** After `start` succeeds, `spec-approve.md` continues
    directly into implementation in the same turn — no further ask, no "Implement,
    then ..." handoff — reusing the same single-task implementation loop
    `/nevo-ai:task-start`/a named-subset batch already drives, rather than a second,
    parallel mechanism. Plain `Approve` (no start) is unmodified — it still stops after
    approval. Every existing D17 stop condition inside "approve and start"
    (`confirm-required`, `unsafe_manual`, `not_retryable`, `partially_completed`,
    unrelated dirty files, scope expansion, an ADR conflict) is unchanged — this closes
    only the success path's ending.
59. **The general rule, stated once for every future compound action:** an owner-facing
    compound action completes the operation its own label promises — if a label says "X
    and Y," the command performs both in the same turn on the success path, never
    X-then-a-textual-pointer-to-Y.
60. **`deriveStage`'s `ready-to-start` stage now checks `depsSatisfied`, closing
    FU-004.** The exact predicate `start` itself uses — reproduced concretely
    2026-08-06, `status` reported a task ready-to-start while its dependency was still
    `in-implementation`. An approved-but-blocked task no longer reports as ready; the
    real next action is whichever other task's own stage actually applies (an earlier
    genuinely-ready approved task, or the blocking dependency's own `needs-approval`/
    `ready-to-start`/`in-progress` stage), or, if no other stage explains it, a new
    explicit `blocked-on-dependencies` stage naming the unmet dependency and its current
    status.

### Formal unowned-drift correction flow (D34, D35)

61. **`classifyUnownedDrift` names the real classification, closing FU-006.**
    `owned` (inside some task's `allowed_paths`/`consequential_paths`, or attributed to
    the task currently under review), `forbidden` (matches any task's `forbidden_paths`
    — never eligible for the lightweight option below, same hard exclusion task 13
    already established for `scope_exceptions`), or `unowned-drift` (outside every
    task's scope, not the current task's own diff).
62. **The three-option owner menu** — create a narrow corrective task, amend/re-attribute
    an existing task's scope, or an explicit owner-authorized maintenance correction —
    replaces the undocumented ad hoc edit FU-006 recorded twice in this repository's own
    history.
63. **The maintenance-correction option persists a structured record, never a silent
    edit.** A `kind: maintenance-correction` `follow-ups.yaml` entry, validated by
    `validateMaintenanceCorrectionEntry` beyond what every follow-up entry already
    requires: exact `paths` (never a glob), `reason`, `confirmed_by: owner`,
    `confirmed_at`, and `revision`.
64. **Visible in review and audit, never silently absent.** A recorded correction
    surfacing in a later `spec-audit`/`task-review` run's scope is named explicitly by
    its follow-up id, never re-flagged as an unexplained anomaly.

### Repository-bound handler testability (D34, D35)

65. **Optional parameters, defaulting to the real repository — no production behavior
    change.** `handleStart(changeSlug, taskId, { activeDir, gitRoot })`,
    `buildSpecsIndexes({ activeDir, archiveDir })`,
    `checkSpecsIndexes({ activeDir, archiveDir, activeIndexMd, archiveIndexMd,
    indexJson })`, and `writeSpecsIndexes(built, { activeIndexMd, archiveIndexMd,
    indexJson })` all default every new parameter to the same module-level constant
    they always read — every existing call site (the CLI, `handleBatchStart`'s forward
    reference) is unaffected.
66. **No service locator, no global mutable configuration.** Parameterization is plain
    function arguments/options objects — nothing settable at the module level, nothing
    that could leak between a test run and a real invocation.
67. **A reusable fixture-repository helper**, `createFixtureRepo`
    (`tools/tests/fixture-repo.test-helper.mjs`) — a throwaway git repository plus a
    minimal `specs/active/<change>/` tree (`change.yaml`, task front matter, a
    controllable task graph) — closes FU-007's two prior workarounds
    (`nextSuspensionForNotRetryable`'s isolated unit test, task 02; the real-repo-
    corrupting REC-03 test, task 10) with real, fixture-backed end-to-end coverage:
    `start` behavior, index staleness, `execution.suspension`, and dependency-aware
    `status` (task 18) against a real, loaded `change.yaml` — none of it touching the
    actual repository.

### Owner-workflow acceptance scenarios (D34, D35)

68. **Fifteen required regression scenarios, each exercising a real handler chain against
    a fixture repository** (`tools/tests/owner-workflow-acceptance.test.mjs`) — never
    only the isolated function each owning task (14-20) already unit-tests alone. Covers
    every property D34 named: compound-action completion, minimal/expanded report
    shapes, bounded per-task context, one consolidated decision stage, real vs.
    non-blocking cross-task findings, independent provenance on a shared file, scoped
    review without re-grading, dependency-aware status, unowned-drift, narrow scope
    exceptions, `HEAD`-advancement-proof evidence, and the aggregate-vs-canonical guard
    (regression only — that mechanism shipped before this refinement pass).
69. **The composite scenario is its own explicit test**, not merely implied by the other
    fourteen: a full fixture run — `start` on two approved tasks, zero genuine owner
    decisions, one consolidated stage, one bulk-eligible set — proves the whole
    one-person-workflow claim directly, not just its individual mechanisms in isolation.
70. **Test-only, by construction.** This task's own `forbidden_paths` excludes every
    production source file it exercises — a gap found here routes back to the owning
    task for a real fix, never a workaround patched into the acceptance suite itself.

## What was deliberately not adopted / not changed

- A full workflow engine or generic state DSL — explicitly rejected as unjustified
  complexity for this repository's actual scale.
- Parallel or concurrent task execution — batch execution stays strictly sequential,
  one task `in-implementation` at a time; concurrent writes to `change.yaml` are unsafe
  and out of scope.
- An event-sourced or history-preserving follow-up ledger — `follow-ups.yaml` is a
  current-state list; git already tracks its history, same reasoning ADR-0004 applied
  to review artifacts.
- Automated tooling that detects a missing `semantic_references` entry — D26's
  completeness check is a documented model-review instruction for `/nevo-ai:spec-review`
  to follow, not a code mechanism; only integrity is checked deterministically.
- Automating the repair-branch flow beyond branch creation — editing files, running the
  targeted checks, and opening the repair PR remain manual, owner-driven steps.
- A fully-implemented `--verbose` mode for `task-review` (D31) — the interface may be
  added later without complicating the default compact flow, but the default shape is
  what this change actually required.
- Resolving a `forbidden_paths` violation through any review-level mechanism (D31) —
  only a specification scope amendment or reverting the change.
- Retroactively rewriting any already-written `reviews/*.md` file from tasks 01-12 to
  the new compact shape (D31) — it applies going forward, on the next
  `task-review`/`implementation-review` run.

## Consequences

- A resumed session can classify *why* the last action stopped and what to retry,
  instead of re-diagnosing from an uncaught exception every time.
- A bare status write, an unrelated task's edit, or a mechanical resolver task no
  longer invalidates a spec review's fingerprint — only a change-scope or task-content
  edit does. Every existing `reviews/spec.md` written under the old whole-file scheme
  became stale the moment this change shipped — a one-time, expected re-review per
  active change, not a recurring cost (see `tasks/09-finalization-hardening-and-migration.md`
  § "Migration notes" for the concrete worked example).
- A linear approved dependency chain can run as one authorized batch with one gating
  review at the end, instead of N single-task round trips — while a genuinely risky
  task in that batch still gets its own full `task-review`, never silently waved
  through.
- A post-merge regression always leaves a diagnostic branch behind, and a guarded path
  to a repair branch, instead of a deleted branch and an already-archived change with
  nowhere to record what went wrong.
- A small, deterministic, already-reviewed-pattern derivative task can skip the
  review-file cost entirely — while every condition failing falls back to the normal
  cycle, never a silent gap.
- More surface area in `tools/specs/lifecycle.mjs`/`tools/specs/service.mjs`/
  `tools/specs.mjs` (batch selection, self-check, evidence freshness, the guarded
  repair-branch sequence) and a correspondingly larger `tools/tests/` suite, including
  task 10's dedicated cross-mechanism end-to-end coverage — judged proportionate given
  each mechanism closes a concretely identified continuity or safety gap, not
  speculative hardening.
- An owner can review and verify N already-implemented tasks in one invocation and one
  bulk confirmation instead of N separate `/nevo-ai:task-review` round trips, without
  weakening any individual task's own review depth or ever moving a task that still
  carries an unresolved blocking finding.
- A passing `task-review`/`implementation-review` report costs a fraction of the tokens
  it used to (D31) — a normal passing report is ~15-30 lines instead of full AC-by-AC
  prose — while a legitimate, narrow, owner-accepted scope exception no longer forces a
  permanent block or a full spec amendment just to reach `pass`.

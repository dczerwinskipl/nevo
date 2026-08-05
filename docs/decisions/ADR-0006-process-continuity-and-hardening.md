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

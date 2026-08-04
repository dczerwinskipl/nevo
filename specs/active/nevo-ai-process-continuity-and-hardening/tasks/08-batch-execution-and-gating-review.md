---
id: nevo-ai-process-continuity-and-hardening.batch-execution-and-gating-review
status: draft
change: nevo-ai-process-continuity-and-hardening
context:
  required:
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/batch-execution-and-gating-review.md
    - specs/active/nevo-ai-process-continuity-and-hardening/owner-decisions.md
    - tools/specs/lifecycle.mjs
    - tools/specs.mjs
    - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
    - .claude/commands/nevo-ai/task-review.md
    - .claude/commands/nevo-ai/task-next.md
  optional:
    - .claude/commands/nevo-ai/spec-audit.md
    - .claude/skills/nevo-ai-spec-workflow/templates/review-report.md
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/context-and-validation-hardening.md
    - specs/active/nevo-ai-process-continuity-and-hardening/areas/state-and-fingerprint-semantics.md
allowed_paths:
  - tools/specs/lifecycle.mjs
  - tools/specs/service.mjs
  - tools/specs.mjs
  - tools/tests/batch.test.mjs
  - .claude/commands/nevo-ai/task-review.md
  - .claude/commands/nevo-ai/task-next.md
  - .claude/skills/nevo-ai-spec-workflow/templates/review-report.md
  - .claude/skills/nevo-ai-spec-workflow/references/review-policy.md
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/**
---

# Task: Batch execution and gating review

> Refined 2026-08-04 (see `owner-decisions.md` D10, D11) — batch progress is now derived
> entirely from `change.yaml`/`execution.suspension`, with no second progress file to
> reconcile; the risk trigger for a full task-review is now evidence-based, not
> path-touch-based, so a small low-risk code task can actually use the lightweight path
> batch mode is supposed to offer.
>
> Refined again 2026-08-04 (second pass, see D19, D20, D21) — the gating batch review now
> requires an evidence-freshness check immediately before it runs. Batch selection is now
> four named modes (`currently-ready` / `all-approved-reachable` / `named-subset` /
> `until-checkpoint`), not one implicit list. This task now depends on
> `scope-and-follow-up-mechanisms` (task 06), the mechanism its gating review reads.
>
> Refined a third time 2026-08-04 (see D24) — a failed or unresolved self-check is no
> longer one of the evidence-based full-review signals. It is a hard stop that halts the
> batch immediately and that a full `task-review` can never substitute for; only once the
> self-check passes do the remaining (self-check-excluding) signals determine whether a
> full review is additionally required.

## Goal

Implement sequential batch execution of already-`approved` tasks (four-mode selection,
dependency ordering, single-active-task constraint, evidence-based risk trigger for full
review, evidence-freshness check, derived progress, resumable intent state, declared
temporary-inconsistency pairs) and the one gating batch review that closes a batch —
exactly as specified in `areas/batch-execution-and-gating-review.md`.

## Dependencies

`conversational-approval-ergonomics` — batch execution reuses the inline-offer/
auto-continue mechanism that task already built the forward-compatible hook for.
`state-and-fingerprint-semantics` — needs correct dependency ordering,
`semantic_references`/the task-level fingerprint (D18, used by the evidence-freshness
check), and the `execution.suspension` schema batch progress derivation reads.
`scope-and-follow-up-mechanisms` (D21, second refinement pass) — the gating batch review
reads open blocking `follow-ups.yaml` entries, a mechanism that task introduces; this
task cannot be implemented meaningfully before it lands.

## Implementation constraints

- **Batch selection is always explicit at start, one of four named modes (D20, second
  refinement pass) — no default:** `currently-ready` (tasks `next`-ready at planning
  time), `all-approved-reachable` (every approved task that will become ready once
  earlier-selected tasks complete — a deterministic topological order over the approved
  subgraph, excluding anything blocked by an unselected prerequisite or an unresolved
  owner decision), `named-subset` (an explicit task-id list, validated for closure over
  required dependencies — a missing prerequisite is reported, never silently included or
  excluded), `until-checkpoint` (the reachable sequence, executed until a named
  checkpoint or stop condition). Implement selection as a single function dispatching on
  mode, not four independent code paths.
- Exactly one task `in-implementation` at a time; the batch controller calls the existing
  `start`/`complete` transitions unchanged — it does not introduce a new write path to
  `change.yaml`.
- **The persisted batch file holds intent only** — `change`, `requestedTasks`,
  `orderedTasks`, `startRevision`, `reviewMode`, `checkpointPolicy`,
  `temporaryInconsistencies`. It must contain **no** `completed`/`current`/`next`/
  `failed` field. Completed/current/next/failed are computed, every time they're needed,
  by reading each `orderedTasks` entry's `status` and `execution.suspension` directly —
  implement this as one pure function (`deriveBatchProgress(change, intent)`), not
  inlined ad hoc at each call site.
- **Hard stop conditions, checked before any risk signal and never bypassable by a full
  review (D24, third refinement pass).** The batch stops immediately when the current
  task has: a failed self-check; an unresolved self-check; a failed acceptance
  criterion; failed automated verification; stale evidence that cannot be refreshed (see
  the evidence-freshness constraint below); missing required evidence; or an
  implementation error preventing verification from running. Implement as a single
  predicate function (e.g. `hardStopReason(task)` returning the specific condition or
  `null`), checked before the risk-signal predicate below — never as a fallthrough case
  inside the risk-signal logic. On a hard stop: preserve the current task/batch state,
  surface the failed criterion or evidence in the batch's reported status, and require
  the implementation to be corrected and the self-check rerun before the batch
  continues — do **not** create or offer a full `task-review` as an alternative path
  around a hard stop.
- A task requires its own full `task-review` before the batch can complete it when its
  self-check has already passed (no hard stop applies) **and**, only then, at least one
  evidence-based signal holds (see `areas/batch-execution-and-gating-review.md`
  requirement 5 for the full list — declared `review: required`, public-API/compat
  impact, security/data-safety impact, migration/destructive-persistence behavior, an
  `owner-decision:`-tagged criterion, scope expansion, missing automated verification,
  unexpected files, implementation divergence, an owner-flagged high-risk task, or
  inspection-only evidence where model review is explicitly required — "self-check
  unresolved or failed" is removed from this list per D24, since it is now a hard stop).
  Touching `src/**`/`tests/**`/`consequential_paths` alone is **not** on this list.
- **Evidence freshness, checked immediately before the gating batch review runs (D19,
  second refinement pass).** Implement as a distinct step, not folded silently into the
  gating review: (1) determine which later-batched tasks' changes could affect an
  earlier task's recorded evidence (file/path overlap); (2) rerun any automated-
  verification command whose target files changed since it last ran; (3) invalidate (and
  require a refresh of) any inspection-type evidence whose referenced files/line ranges
  changed since it was recorded; (4) treat evidence for a task whose own
  `semantic_references`-based task-level fingerprint (D18) has changed since the
  evidence was recorded as stale regardless of file-level overlap. The gating batch
  review must not run while any batched task carries stale, unrefreshed evidence —
  evidence that cannot be refreshed is itself a hard stop condition (D24, see above),
  not something the gating review proceeds past with a caveat.
  Evidence tracked per item stays compact: a revision/content-hash identifier,
  referenced files/path ranges, command identity (for automated evidence), and the
  task's semantic fingerprint at record time — never full command output or full diffs.
  Owner-recorded evidence stays valid as long as the task's semantic fingerprint is
  unchanged.
- The gating batch review writes `specs/active/<change-id>/reviews/batch-<n>.md` (or
  equivalent, distinct from `reviews/<task-id>.md` and `reviews/audit-<slug>.md`), with
  verdict `changes-recommended` \| `owner-decision-required` \| `no-findings` computed
  from an explicit table. It never re-evaluates any individual batched task's own
  acceptance criteria — it checks the whole-batch diff since `startRevision`, cross-task
  integration, and open blocking follow-up entries (`follow-ups.yaml`, D22) only.
- A declared temporary-inconsistency pair names both tasks explicitly before the batch
  starts; `validate`/`check` is skipped between exactly that pair and enforced at every
  other boundary, including the batch's own end.
- `task-review.md`'s batch-continuation offer (the forward-compatible check added in task
  04) now has a real active-batch intent file to check against — this task makes the
  offer actually appear when a batch is active.

## Acceptance criteria

1. A batch runs strictly in `depends_on` order and is rejected before any task starts if
   unsatisfiable (automated: `node --test tools/tests/batch.test.mjs`).
2. Exactly one task is ever `in-implementation` during a batch run (automated).
3. The persisted batch file contains no progress fields; `deriveBatchProgress` correctly
   reconstructs completed/current/next/failed from `change.yaml` alone after a simulated
   interruption between writes (automated).
4. A task meeting no evidence-based risk signal completes via self-check plus the gating
   batch review only (automated).
5. A task meeting at least one risk signal cannot be batch-completed without its own
   `task-review` (automated).
6. A declared temporary-inconsistency pair does not fail `validate` mid-batch; an
   undeclared inconsistency between any other pair still does (automated).
7. The gating batch review's verdict is computed from an explicit table and never
   contains a re-evaluation of an individual task's own acceptance criteria (inspection +
   automated verdict-table test).
8. `all-approved-reachable` selects a full linear approved dependency chain that
   `currently-ready` alone would only ever select the first task of (automated, same
   suite) (D20).
9. A `named-subset` selection missing a required prerequisite is reported, not silently
   completed or rejected without explanation (automated, same suite) (D20).
10. A later batched task's file/command-overlapping change invalidates an earlier task's
    recorded evidence, and the gating batch review does not run until it's refreshed
    (automated, same suite) (D19).
11. An unrelated later-batched task's change does not stale an earlier task's evidence
    (automated, same suite) (D19).
12. A failed self-check stops the batch immediately, without ever offering or creating a
    full `task-review` as a substitute (automated, same suite) (D24).
13. A full `task-review` cannot mark a hard-stopped task complete while its self-check is
    still failing (automated, same suite) (D24).
14. Correcting the implementation and rerunning a previously-failing self-check resumes
    the batch (automated, same suite) (D24).
15. A task whose self-check now passes but that meets an independent risk signal still
    requires a full `task-review` (automated, same suite) (D24).
16. A passing, low-risk code task (no hard stop, no risk signal) proceeds to the final
    gating batch review without a full `task-review` (automated, same suite) (D24).

## Verification

```
node --test tools/tests/batch.test.mjs
node --test tools/tests/task-lifecycle.test.mjs
node tools/specs.mjs validate
```

## Documentation impact

`task-review.md`, `task-next.md`, `review-policy.md` (new "batch review" subsection),
`templates/review-report.md` (batch review shape, if it diverges from the existing
table).

## Out of scope

- Parallel or concurrent task execution.
- Changing what `spec-review`/`spec-approve` require before a task can enter a batch.
- Any second persisted copy of task progress (explicitly rejected by D10).

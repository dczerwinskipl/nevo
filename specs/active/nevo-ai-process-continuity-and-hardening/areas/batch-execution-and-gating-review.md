# Area: Batch execution and gating review

> Refined 2026-08-04 — see `owner-decisions.md` D10, D11. Batch progress is now derived,
> not duplicated; risk classification is evidence-based, not path-touch-based.
>
> Refined again 2026-08-04 (second pass) — see D19, D20, D21. The gating batch review now
> requires an evidence-freshness check immediately before it runs, closing a path to
> approving a regression a later task's changes could invalidate. Batch selection is now
> four named modes, not one implicit list — `all-approved-reachable` is new and is what
> makes "run every approved task the graph will let you reach" expressible for a linear
> dependency chain. This area's own task (08) now depends on `scope-and-follow-up-mechanisms`
> (task 06), the mechanism its gating review reads.
>
> Refined a third time 2026-08-04 — see D24. A failed or unresolved self-check is no
> longer one of D11's full-review risk signals — it is a **hard stop** that halts the
> batch immediately and that no full `task-review` can substitute for. Requirement 5 is
> split into two disjoint predicate sets: hard stop conditions (requirement 4a) and
> full-review risk signals (requirement 5, unchanged in substance minus the removed
> self-check entry).

## Responsibility

Own sequential multi-task execution of already-`approved` tasks, and the one gating
batch/change-integrity review that closes a batch — distinct from the existing,
deliberately non-gating `spec-audit`.

## Current state

No batch execution exists in any command. `spec-audit` never re-checks a task's own
acceptance criteria and its verdict never gates anything. `task-next` returns exactly one
task per call. Full citations in `overview.md` § "Review, audit, and evidence".

## Requirements

1. **Batch selection has four named modes, chosen explicitly at batch start — no default
   (D20, second refinement pass):**

   | Mode | Selects |
   |---|---|
   | `currently-ready` | Only tasks `next`-ready at planning time. |
   | `all-approved-reachable` | Every approved task that will become ready once earlier-selected tasks complete — a deterministic topological order over the approved subgraph, excluding anything blocked by an unselected prerequisite or an unresolved owner decision. Required to express "run every approved task reachable through the graph" for a dependency chain where `currently-ready` alone would only ever select the first task. |
   | `named-subset` | An explicit task-id list; validated for closure over required dependencies — a missing prerequisite is reported, never silently included or excluded. |
   | `until-checkpoint` | The reachable sequence, executed until a named checkpoint or stop condition is hit. |

2. Ordering follows the existing `depends_on`/`next` logic exactly, within whichever mode
   was selected; an unsatisfiable batch is rejected before any task starts.
3. Exactly one task `in-implementation` at a time.
4. **Batch progress is derived, never duplicated (D10).** The only persisted batch file
   holds intent:

   ```json
   {
     "change": "nevo-ai-process-continuity-and-hardening",
     "requestedTasks": ["task-a", "task-b", "task-c"],
     "orderedTasks": ["task-a", "task-b", "task-c"],
     "startRevision": "<git sha at batch start>",
     "reviewMode": "batch",
     "checkpointPolicy": "...",
     "temporaryInconsistencies": []
   }
   ```

   No `completed`/`current`/`next`/`failed` field exists in this file. Those are always
   computed by reading each `orderedTasks` entry's `status` and `execution.suspension`
   (area `state-and-fingerprint-semantics`/`recovery-and-resume`) directly from
   `change.yaml` at the moment they're needed. There is nothing to reconcile after an
   interrupted write, because there is only one write location for progress
   (`change.yaml`'s own task status, already covered by area `recovery-and-resume`'s
   postcondition model).
4a. **Hard stop conditions, evaluated before any risk signal and never overridable by a
   full review (D24, third refinement pass).** The batch stops immediately when any of
   the following holds for the current task: a failed self-check; an unresolved
   self-check; a failed acceptance criterion; failed automated verification; stale
   evidence that cannot be refreshed (requirement 5a); missing required evidence; or an
   implementation error that prevents verification from running at all. A full
   `task-review` is never a path around a hard stop — routing a hard-stop condition to
   full review instead of fixing it is exactly the defect this requirement exists to
   prevent. After a hard stop: preserve the current task and batch state; report the
   failed criterion or evidence; require the implementation to be corrected; rerun the
   self-check; continue only once it passes. A hard stop does not use
   `execution.suspension` — see `areas/recovery-and-resume.md` § "Out of scope" for why
   this is deliberately outside that model's scope. Once the self-check passes, proceed
   to requirement 5 to determine whether a full review is additionally required.
5. **Risk classification is evidence-based (D11, corrected by D24 to exclude the
   self-check signal — see requirement 4a), not path-touch-based.** A task requires its
   own full `task-review` before the batch can complete it when, and only when — its
   self-check has already passed (requirement 4a) **and** — at least one of the
   following holds: it declares `review: required`; it has public-API or compatibility
   impact; it has security/authorization/data-safety impact; it involves migration or
   destructive persistence behavior; it has an `owner-decision:`-tagged acceptance
   criterion; its scope expanded during implementation (`REC-08`); it's missing
   automated verification; it touched files outside its approved path model; its
   implementation diverges from the approved design; the owner flagged it high-risk
   explicitly; or it carries inspection-only evidence where model review is explicitly
   required. Touching `src/**`/`tests/**`/`consequential_paths` alone is **not**
   sufficient — a small, low-risk code task whose self-check passed and that meets none
   of the above signals is eligible for self-check plus the end-of-batch gating review
   only.
5a. **Evidence freshness, checked immediately before the gating review runs (D19,
   second refinement pass).** A task passing its self-check earlier in the batch is not
   proof its evidence is still trustworthy once a later batched task has touched the same
   subsystem. Before the gating batch review (requirement 7) proceeds: (a) determine
   which later-batched tasks' changes could affect an earlier task's recorded evidence;
   (b) rerun any automated-verification command whose target files changed since it last
   ran; (c) invalidate (and require a refresh of) any inspection-type evidence whose
   referenced files/line ranges changed since it was recorded; (d) treat evidence for a
   task whose own semantic fingerprint (`semantic_references`, D18) has changed since the
   evidence was recorded as stale regardless of file-level overlap. Owner-recorded
   evidence stays valid as long as the task's semantic fingerprint is unchanged — an
   operational status change alone does not stale it. The gating batch review does not
   run while any batched task carries stale, unrefreshed evidence. Evidence tracked per
   item: a revision/content-hash identifier, referenced files/path ranges, command
   identity (for automated evidence), and the task's semantic fingerprint at record time
   — never full command output or full diffs.
6. **Layer responsibilities**, kept non-overlapping:

   | Layer | Scope | Re-checks acceptance criteria? |
   |---|---|---|
   | Task self-check | One task's own `Verification` commands | Yes, for that task only |
   | Full task review | One risky task's diff | Yes, in depth |
   | Evidence freshness check (D19) | Whether earlier-recorded batch evidence is still current | N/A — refreshes/reruns evidence; does not itself judge acceptance criteria |
   | Gating batch review | Whole-batch diff since `startRevision`, cross-task integration, open follow-ups | No |
   | Advisory `spec-audit` | One named cross-cutting lens | No (pre-existing rule, unchanged) |

7. Gating batch review, produced once at the end of a batch, only after the evidence-
   freshness check (requirement 5a) reports every batched task's evidence current:
   verdict `changes-recommended` \| `owner-decision-required` \| `no-findings`, computed
   from an explicit table, checking the complete diff against `startRevision`,
   integration between batched tasks, and any open blocking follow-up entries (area
   `context-and-validation-hardening`) raised during the batch. It does not re-litigate
   any individual task's own acceptance criteria (requirement 6).
8. Interruption and resume: an interrupted batch resumes from `deriveStage` (now
   suspension-aware) plus the persisted intent file — no reconciliation step exists
   because there is nothing duplicated to reconcile (requirement 4).
9. Temporary inconsistency: unchanged from the original draft — declared between two
   named tasks before the batch starts, visible in the intent file's
   `temporaryInconsistencies`, `validate`/`check` skipped only for that declared pair.
10. Failure behavior: a real blocker (`owner-decision` or `unsafe-manual` class, area
    `recovery-and-resume`) stops the batch at the failing task; completed tasks keep
    their terminal status; resume picks up from `deriveStage` plus the intent file. A
    hard stop (requirement 4a) is a distinct, more common failure mode — the failing
    task's `status` stays `in-implementation` (not suspended), and resume is simply
    "correct the implementation, rerun the self-check" — no `deriveStage`/suspension
    involvement is needed for this case specifically.

## Constraints

- Never make batch mode the default.
- Never let the gating batch review substitute for a risky task's own required
  `task-review` (requirement 5).
- **Never let a full `task-review` substitute for a hard stop (D24, third refinement
  pass)** — a hard stop condition (requirement 4a) always requires the implementation to
  be corrected and the self-check rerun; it is never resolved by routing to full review
  instead.
- No parallel writes to `change.yaml`.
- No second, duplicated progress field anywhere in the batch intent file — if a future
  change to this area proposes adding one, it must also define write order, atomicity,
  reconciliation, and crash recovery for it (the burden D10 was written to avoid).
- The gating batch review must never run while stale evidence is unresolved (requirement
  5a) — there is no "proceed with a caveat" path; unrefreshable stale evidence is itself
  a hard stop (requirement 4a).

## Interfaces and boundaries

Exposes: batch selection/ordering (four named modes, D20), the intent-only persisted
file, the hard-stop predicate (D24), the evidence-based risk trigger, the
evidence-freshness check, the gating batch review shape and verdict table.

Consumes: `conversational-continuity`'s inline "continue to next batch task" offer;
`recovery-and-resume`'s classified errors and suspension state for failure handling and
progress derivation; `context-and-validation-hardening`'s `follow-ups.yaml` (D22) and
`state-and-fingerprint-semantics`' `semantic_references`/task-level fingerprint (D18,
used by the evidence-freshness check); `state-and-fingerprint-semantics`' corrected
`depsSatisfied`.

## Area-specific acceptance criteria

- A test proves a batch runs tasks strictly in dependency order and rejects an
  unsatisfiable batch before starting any task.
- A test proves exactly one task is ever `in-implementation` during a batch run.
- A test proves a task meeting none of the evidence-based risk signals completes via
  self-check plus the gating batch review only (no full `task-review` required).
- A test proves a task meeting at least one risk signal cannot be batch-completed
  without its own `task-review`.
- A test proves an interrupted batch reconstructs its progress correctly from
  `change.yaml` alone, with no second file to reconcile.
- A test proves a declared temporary inconsistency between two named tasks does not fail
  `validate` mid-batch, but an undeclared one between any other pair still does.
- A test proves `all-approved-reachable` selects a full linear approved dependency chain
  that `currently-ready` alone would only ever select the first task of (D20).
- A test proves a `named-subset` selection missing a required prerequisite is reported,
  not silently completed or rejected without explanation (D20).
- A test proves a later batched task's file/command-overlapping change invalidates an
  earlier task's recorded evidence, and that the gating batch review does not run until
  it's refreshed (D19).
- A test proves an unrelated later-batched task's change does not stale an earlier task's
  evidence (D19).
- A test proves a failed self-check stops the batch immediately, without routing to full
  `task-review` (D24).
- A test proves a full `task-review` cannot mark a hard-stopped task complete while its
  self-check is still failing (D24).
- A test proves correcting the implementation and rerunning a previously-failing
  self-check resumes the batch (D24).
- A test proves a task whose self-check now passes but that meets an independent risk
  signal still requires a full `task-review` (D24).
- A test proves a passing, low-risk code task (no hard stop, no risk signal) proceeds to
  the final gating batch review without a full `task-review` (D24).

## Dependencies

`conversational-continuity` (task 04) — batch execution reuses the same inline-offer/
auto-continue mechanism. `state-and-fingerprint-semantics` (task 01) — needs correct
dependency ordering, `semantic_references`/the task-level fingerprint (D18, used by the
evidence-freshness check), and the `execution.suspension` schema batch progress
derivation reads. `scope-and-follow-up-mechanisms` (task 06, D21, second refinement
pass) — the gating batch review reads open blocking `follow-ups.yaml` entries, a
mechanism task 06 introduces; task 08 cannot be implemented meaningfully before it. A
dependency on `mechanical-task-type` (task 07) was evaluated and found unnecessary: a
`type: mechanical` task is ordinary from batch execution's perspective (D14 requirement
21) — this area has no code path that needs task 07's contract specifically.

## Out of scope

- Parallel or concurrent task execution.
- Making the gating batch review replace `spec-review`/`spec-approve` for tasks entering
  the batch.
- Any second persisted copy of task progress (explicitly rejected by D10).

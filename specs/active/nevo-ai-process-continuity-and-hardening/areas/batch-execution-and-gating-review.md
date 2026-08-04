# Area: Batch execution and gating review

> Refined 2026-08-04 — see `owner-decisions.md` D10, D11. Batch progress is now derived,
> not duplicated; risk classification is evidence-based, not path-touch-based.

## Responsibility

Own sequential multi-task execution of already-`approved` tasks, and the one gating
batch/change-integrity review that closes a batch — distinct from the existing,
deliberately non-gating `spec-audit`.

## Current state

No batch execution exists in any command. `spec-audit` never re-checks a task's own
acceptance criteria and its verdict never gates anything. `task-next` returns exactly one
task per call. Full citations in `overview.md` § "Review, audit, and evidence".

## Requirements

1. Batch selection, chosen once at batch start: all currently `next`-ready tasks, an
   explicit named subset, or "run until the next owner-decision checkpoint." No default.
2. Ordering follows the existing `depends_on`/`next` logic exactly; an unsatisfiable
   batch is rejected before any task starts.
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
5. **Risk classification is evidence-based (D11), not path-touch-based.** A task
   requires its own full `task-review` before the batch can complete it when, and only
   when, at least one holds: it declares `review: required`; it has public-API or
   compatibility impact; it has security/authorization/data-safety impact; it involves
   migration or destructive persistence behavior; it has an `owner-decision:`-tagged
   acceptance criterion; its scope expanded during implementation (`REC-08`); its
   self-check is unresolved or failed; it's missing automated verification; it touched
   files outside its approved path model; its implementation diverges from the approved
   design; or the owner flagged it high-risk explicitly. Touching `src/**`/`tests/**`/
   `consequential_paths` alone is **not** sufficient — a small, low-risk code task
   meeting none of the above signals is eligible for self-check plus the end-of-batch
   gating review only.
6. **Layer responsibilities**, kept non-overlapping:

   | Layer | Scope | Re-checks acceptance criteria? |
   |---|---|---|
   | Task self-check | One task's own `Verification` commands | Yes, for that task only |
   | Full task review | One risky task's diff | Yes, in depth |
   | Gating batch review | Whole-batch diff since `startRevision`, cross-task integration, open follow-ups | No |
   | Advisory `spec-audit` | One named cross-cutting lens | No (pre-existing rule, unchanged) |

7. Gating batch review, produced once at the end of a batch: verdict
   `changes-recommended` \| `owner-decision-required` \| `no-findings`, computed from an
   explicit table, checking the complete diff against `startRevision`, integration
   between batched tasks, and any open blocking follow-up entries (area
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
    their terminal status; resume picks up from `deriveStage` plus the intent file.

## Constraints

- Never make batch mode the default.
- Never let the gating batch review substitute for a risky task's own required
  `task-review` (requirement 5).
- No parallel writes to `change.yaml`.
- No second, duplicated progress field anywhere in the batch intent file — if a future
  change to this area proposes adding one, it must also define write order, atomicity,
  reconciliation, and crash recovery for it (the burden D10 was written to avoid).

## Interfaces and boundaries

Exposes: batch selection/ordering, the intent-only persisted file, the evidence-based
risk trigger, the gating batch review shape and verdict table.

Consumes: `conversational-continuity`'s inline "continue to next batch task" offer;
`recovery-and-resume`'s classified errors and suspension state for failure handling and
progress derivation; `context-and-validation-hardening`'s `follow-ups.md`;
`state-and-fingerprint-semantics`' corrected `depsSatisfied`.

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

## Dependencies

`conversational-continuity` (task 04) — batch execution reuses the same inline-offer/
auto-continue mechanism. `state-and-fingerprint-semantics` (task 01) — needs correct
dependency ordering and the `execution.suspension` schema batch progress derivation reads.

## Out of scope

- Parallel or concurrent task execution.
- Making the gating batch review replace `spec-review`/`spec-approve` for tasks entering
  the batch.
- Any second persisted copy of task progress (explicitly rejected by D10).

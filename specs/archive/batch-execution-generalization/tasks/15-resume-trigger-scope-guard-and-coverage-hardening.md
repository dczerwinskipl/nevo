---
id: resume-trigger-scope-guard-and-coverage-hardening
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - tools/dashboard/server/ai/orchestration/admission.mjs
    - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
    - tools/tests/batch-completion-orchestration.test.mjs
    - specs/active/batch-execution-generalization/tasks/14-real-end-to-end-automatic-resume-proof.md
semantic_references:
  decisions: []
allowed_paths:
  - tools/dashboard/server/ai/orchestration/admission.mjs
  - tools/dashboard/server/ai/orchestration/batch-completion-settlement.mjs
  - tools/tests/batch-completion-orchestration.test.mjs
  - specs/active/batch-execution-generalization/tasks/14-real-end-to-end-automatic-resume-proof.md
forbidden_paths:
  - src/**
  - tools/dashboard/ui/**
  - tools/specs/workflow/**
  - tools/dashboard/server/ai/sessions/turns/routes.mjs
  - tools/dashboard/server/ai/orchestration/reconciliation.mjs
  - tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs
depends_on: [durable-grouped-handover-resume-generalization, real-end-to-end-automatic-resume-proof]
---

# Task: Scope-guard the resume trigger to task-only, close task 13's own test-coverage gap, and reconcile task 14's wording with its actual test level

## Goal

Third-round corrective task from `overview.md` § "Third-round review correction". A
third review round (head `97b50d0`) confirmed the singleton-first deadlock (finding 1)
and the transient/terminal misclassification (finding 2) are genuinely fixed, and that
tasks D/D2 now prove real automatic resume without manual `clearActiveAgentExecution` —
but found three remaining issues:

1. **MAJOR — the new resume trigger is not scope-guarded to singletons in two of its
   three call sites.** Task 13 explicitly required the trigger to fire only for
   `capturedScope.kind === 'task'` and explicitly said "do not duplicate the trigger for
   task-batch." The `'completed'` outcome branch is safe only because `task-batch`
   already returns early before reaching the trigger call. The `'resumable'` branch and
   the final `else` (`'recovery-required'`) branch have no such guard at all — they run
   for both `task` and `task-batch` scope. A child batch that fails closed to
   `recovery-required` could, in a race where its own recovery-required claim marking
   does not hold, trigger an automatic resume of a sibling group while its own batch is
   still unresolved, which contradicts fail-closed semantics.
2. **MAJOR verification gap — task 13 is `verified` but several of its own declared
   `automated:` acceptance criteria are not actually exercised by a dedicated test.**
   The landed test suite covers a singleton-first automatic resume, and a grouped
   admission attempt that *throws* during session creation. It does not cover: (a) a
   grouped admission attempt that returns a genuine (non-exception)
   `WORKSPACE_WRITER_CONTENDED`/`DEFERRED_TO_PENDING_WORKSPACE_REQUEST`-style result
   staying pending; (b) the singleton branch's own transient classification (only the
   grouped branch's transient path has a dedicated test); (c) a reason outside the
   transient set remaining terminally `'failed'` via the admission-failure path itself
   (the existing "gap 2" test's failure comes from `validateBatchCompatibility`, a
   different code path, never from `admitAgentExecution`'s own reason).
3. **Task 14's Test D/D2 do not literally satisfy their own written requirement.** Task
   14 required settling the first dispatch unit via "real `executeBatchStart`/
   `executeBatchFinish`" (the same production primitives Test A uses). Test D/D2 instead
   advance `workflow_progress` directly and save a `batch-finish` record manually, then
   call the real `executeBatchCompletionSettlement`. This does not invalidate the
   automatic-resume proof itself (which is real), but task 14's own requirement text
   overstates what was actually exercised. Per the review's own offered resolution: real
   `BatchStart`/`BatchFinish` is already exhaustively proven by Test A (task 12) and
   tasks 09/10 — Test D/D2's own job is specifically to prove the *resume* mechanism, at
   the same settlement-level fidelity task 11/13's own dedicated tests already
   established. This task reconciles task 14's wording with that reality rather than
   re-engineering D/D2 to duplicate Test A's own full BatchStart/BatchFinish proof.

## Requirements

### Scope guard (finding 1)

- In `admission.mjs`'s `reconcileHook1`, add an explicit `capturedScope.kind === 'task'`
  condition to the `triggerPendingHandoverResume` call in both the `'resumable'` branch
  and the final `else` (`'recovery-required'`) branch — exactly mirroring the existing,
  already-correct guard the `'completed'` branch gets for free from the `task-batch`
  early return.
- Do not change the `'completed'` branch — it is already correct.

### Coverage hardening (finding 2)

- Add a test proving a grouped-handover admission attempt that receives a genuine,
  non-exception `{ admitted: false, reason: 'DEFERRED_TO_PENDING_WORKSPACE_REQUEST' }`
  (or an equivalent transient reason sourced from `admitAgentExecution`'s own return
  value, not a thrown error) leaves its unit `'pending'`, and that removing the
  underlying contention lets a later pass admit it.
- Add a test proving the same for the singleton (`!unit.isGroup`) branch — a singleton
  admission attempt blocked by a genuine transient reason leaves its unit `'pending'`,
  not recorded as a member outcome for that pass.
- Add a direct, explicit test of the transient/terminal classification itself (export
  the existing `TRANSIENT_ADMISSION_REASONS` set from `batch-completion-settlement.mjs`
  for this purpose) enumerating every reason string `admitAgentExecution` can actually
  return — confirming each of the five named transient reasons classifies as transient,
  and every other known reason string (e.g. `CLAIM_ENRICHMENT_FAILED`,
  `STARTED_STATE_TRANSITION_FAILED`, `SESSION_SUBSCRIPTION_FAILED`,
  `INVOKING_STATE_TRANSITION_FAILED`, `ACTIVE_EXECUTION_EXISTS` is already covered
  end-to-end elsewhere) classifies as non-transient. This is a direct unit-level proof
  of the classification function, complementing (not replacing) the end-to-end tests —
  state this explicitly in the test's own description, same discipline task 07's AC2
  already established for "covered elsewhere vs. covered here."
- Add a regression test proving the finding-1 fix itself: a `task-batch`-scoped
  execution that settles to `'recovery-required'` (or `'resumable'`) must NOT trigger
  `resumePendingHandoverForSpec` — a sibling's durably pending unit must remain
  untouched (still `'pending'`) after such an event.

### Task 14 wording reconciliation (finding 3)

- Edit `tasks/14-real-end-to-end-automatic-resume-proof.md`'s own Requirements section:
  add a clearly dated "Third-round scope clarification" note stating that Test D/D2
  prove the resume mechanism at the settlement level (advancing `workflow_progress` plus
  a real batch-finish record for the first dispatch unit, then a real
  `executeBatchCompletionSettlement`/`releaseAdmittedExecution` call) — the same
  fidelity task 11's and 13's own dedicated tests already use — and that real
  `BatchStart`/`BatchFinish` execution is a separate, already-proven claim (Test A, task
  09/10/12), not re-proven by D/D2. Do not change task 14's own `status`, fingerprints,
  or already-recorded verification history — this is a documentation correction to an
  already-verified task's own prose, following the same precedent as the scope-amendment
  notes already used elsewhere in this change (task 09's `allowed_paths` amendment).
- Do not modify the actual test file (`real-end-to-end-corrective-acceptance.test.mjs`)
  under this task — it is explicitly out of this task's `allowed_paths`/scope; the
  reconciliation is wording-only.

## Implementation constraints

- Do not modify `tools/specs/workflow/**`, `routes.mjs`, or `reconciliation.mjs`.
- Do not modify `real-end-to-end-corrective-acceptance.test.mjs` — that file's own tests
  already pass and are correctly scoped to task 12/14; this task's finding-3 fix is
  wording-only, confined to task 14's own `.md` file.
- Preserve every existing passing acceptance criterion from tasks 11/13 — additive only.

## Acceptance criteria

- The `'resumable'` and `'recovery-required'` branches' resume-trigger calls are
  guarded by `capturedScope.kind === 'task'`; a `task-batch` scope settling to either
  outcome does not call `triggerPendingHandoverResume`.
  `inspection: admission.mjs's resumable/recovery-required branches both read capturedScope.kind === 'task' before calling triggerPendingHandoverResume`
- A regression test proves a `task-batch` scope reaching `recovery-required` does not
  wake a sibling's pending unit.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A grouped-handover unit blocked by a genuine (non-exception)
  `DEFERRED_TO_PENDING_WORKSPACE_REQUEST`-style result stays pending and is admitted on
  a later pass once the contention clears.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A singleton unit blocked by the same kind of genuine transient result stays pending.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- A direct classification test confirms every transient reason string classifies as
  transient and every other known admission reason string does not.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
- `tasks/14-real-end-to-end-automatic-resume-proof.md` carries an explicit, dated
  clarification reconciling its own Requirements wording with what Test D/D2 actually
  exercise — without changing its recorded status or verification history.
  `inspection: task 14's own .md file contains a dated Third-round scope clarification note`
- Every existing test in `tools/tests/batch-completion-orchestration.test.mjs` and
  `tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs` still passes.
  `automated: node --test tools/tests/batch-completion-orchestration.test.mjs`
  `automated: node --test tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs`

## Verification

```bash
node --test tools/tests/batch-completion-orchestration.test.mjs
node --test tools/dashboard/tests/real-end-to-end-corrective-acceptance.test.mjs
node --test tools/tests/
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

Any new production code beyond the scope guard. Any rewrite of task 14's own test file.
Any new scheduler or cross-spec scan.

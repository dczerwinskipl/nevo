---
id: deterministic-workflow-foundation.step-active-completed-lifecycle
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/multi-step-workflow-orchestration.md
    - tools/specs/workflow/step-runner.mjs
    - tools/specs/workflow/step-context.mjs
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/cli.mjs
    - tools/specs/workflow/definitions/schema.mjs
    - tools/specs/validation.mjs
    - tools/specs/store.mjs
  optional:
    - tools/specs/workflow/definitions/loader.mjs
    - tools/specs/lifecycle-primitives.mjs
    - docs/development/workflow-engine.md
allowed_paths:
  - tools/specs/validation.mjs
  - tools/specs/store.mjs
  - tools/specs/workflow/step-runner.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/definitions/schema.mjs
  - tools/specs/workflow/index.mjs
  - .nevo-ai/workflows/standard.yaml
  - .nevo-ai/workflows/architectural.yaml
  - .nevo-ai/workflows/small.yaml
  - .nevo-ai/workflows/exploratory.yaml
  - tools/specs/workflow/templates/standard.yaml
  - tools/specs/workflow/templates/architectural.yaml
  - tools/specs/workflow/templates/small.yaml
  - tools/specs/workflow/templates/exploratory.yaml
  - docs/development/workflow-engine.md
  - tools/tests/workflow-next-step.test.mjs
  - tools/tests/workflow-finish-operation.test.mjs
  - tools/tests/workflow-cli.test.mjs
  - tools/tests/workflow-e2e.test.mjs
  - tools/tests/store.test.mjs
  - tools/tests/workflow-compatibility.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
  - tools/specs/workflow/contracts.mjs
  - tools/specs/workflow/registry.mjs
  - tools/specs/workflow/engine.mjs
  - tools/specs/workflow/errors.mjs
  - tools/specs/workflow/compatibility.mjs
  - tools/specs/workflow/human-verification-store.mjs
  - tools/specs/workflow/gates/**
  - tools/specs/workflow/actions/**
  - tools/specs/workflow/definitions/loader.mjs
semantic_references:
  decisions: [D9, D10, D13, D14, D18, D19, D22, D23, D25, D28, D30, D32, D37]
  constraints: [C6, C11, C14, C15, C17, C18, C19, C21, C22, C27, C28, C29]
  dependency_contracts: [multi-step-workflow-progression, fail-closed-workflow-definition-resolution]
---

# Task: Runtime `active`/`completed` step-state axis

## Goal

Correct Task 08's already-verified implementation so a step's completion and the next
step's activation become two distinct, persisted, resumable moments instead of one
atomic write (D37, `areas/multi-step-workflow-orchestration.md` §17). Today,
`finish(A) -> workflow_progress.current_step = B` happens the instant `finish` succeeds —
there is no observable state for "A is done, B hasn't started." This task makes
`workflow step start` the *only* operation that ever advances `current_step`, and
`workflow step finish` responsible only for marking the current step `completed`.

This task does **not** reopen Task 08's own approval — Task 08's schema/store/identity/
versioning/cardinality/identifier work (D18's `workflow_progress` field, D23, D24/D29,
D26, D27, D30, D32) remains sound. This task corrects, in place, exactly the parts D37
identifies: the shape of `workflow_progress`, the semantics of `step start`/`step
finish`'s internal-transition case, position/semantic-status resolution, and the
`update-task` crash-reconciliation intent.

1. **`workflow_progress.state` (D37).** Add a `state: active | completed` field,
   alongside the existing `current_step`/`history` (D18, unchanged shape). No third,
   separately-persisted semantic-status field is ever added — semantic status is always
   derived from `(current_step, state, definition)`.
2. **Per-step semantic status schema (D37, D25 companion).** Every step in a production
   deterministic workflow definition must declare `status: { active: <identifier>,
   completed: <identifier> }` — both required, validated against the existing
   `SAFE_IDENTIFIER_PATTERN` (D30), non-empty. Not a display/i18n concern — stable
   semantic-status identifiers only.
3. **Position/semantic-status resolution — pure function of `(workflow_progress,
   definition)` (D37, replaces D28's `task.status`-first precedence).**
   - No `workflow_progress` → `new`.
   - `state: active` → resolved step is `current_step`; semantic status =
     `definition.steps[current_step].status.active`.
   - `state: completed` and the step's one transition (D27) names another declared step
     → resolved step is `current_step`, awaiting activation of the named target;
     semantic status = `definition.steps[current_step].status.completed`.
   - `state: completed` and the step's one transition names no declared step (terminal,
     D19 refined) → workflow complete; semantic status =
     `definition.steps[current_step].status.completed`.
   - `task.status` is **never** consulted by this resolution — it remains the
     independently-written, coarse repository lifecycle axis (`depends_on` satisfaction,
     `approve`, archival), updated by `finish`'s terminal case as before (D13/C14), never
     read to determine workflow position.
4. **`workflow step start` becomes semantically real (D37).** Previously fully
   non-mutating (`compileStepContext`, Task 08/D10). Four cases, exactly as item 3's
   resolution above discriminates them:
   - **A. Fresh:** atomically persist `current_step: entryStep, state: active`; return
     that step's `StepContext`.
   - **B. Active:** resume — return the same `StepContext`; no mutation.
   - **C. Completed, transition names a step:** atomically persist `current_step:
     <target>, state: active`; return the new step's `StepContext`. No `history` entry —
     `history` only records completions, never activations.
   - **D. Terminal:** report the workflow complete; start nothing.
   - One atomic `workflow_progress` write via `setTaskWorkflowState` (D32), nothing more
     — do not add a new durable multi-stage operation record for this; a crash before
     the write means the next call re-resolves the identical case and writes the
     identical value, a crash after means the next call resolves case B and returns the
     current `StepContext`. Idempotent by construction.
5. **`workflow step finish`, internal-transition case (terminal case materially
   unchanged from Task 08).** For an active step whose one transition names another
   declared step:
   1. evaluate/verify exit gates (unchanged),
   2. run finalize actions through the existing durable finish operation (unchanged
      mechanism — D23's step-aware record identity/path is unaffected, since `finish`
      no longer changes which step it belongs to),
   3. atomically, via `setTaskWorkflowState`: `current_step` **unchanged**; `state:
      completed`; append one `history` entry `{ step, completed_at, transitioned_to:
      <target> }`. `task.status` untouched.
   - The terminal case keeps writing `state: completed` + `task.status = <terminal
     value>` + the `history` entry in the one atomic write, exactly as Task 08 already
     does — `current_step` keeps naming the final completed step (D28's "never cleared"
     invariant, unaffected).
6. **Repeated `finish` on an already-`completed` step is non-actionable (new
   requirement).** No intervening `step start`: resolve position, see `state:
   completed`, return an explicit `already-completed`-shaped result — distinct from
   `blocked`/`input-required`/a just-now `completed` result — without touching the
   finalize/finish-operation machinery, never re-running finalize side effects or
   re-evaluating gates.
7. **Crash/retry reconciliation, generalized (D37, corrects D14/C18's `update-task`
   intent).** The persisted `update-task` stage intent becomes a uniform `{ fromState:
   'active', toState: 'completed' }` comparison against `workflow_progress.state` at the
   operation's own step (plus, for the terminal case only, the existing `{ toStatus:
   <terminal value> }` component for the `task.status` write) — replacing Task 08's
   `{kind:'step', fromStep, toStep}` comparison, which compared `current_step` values
   that no longer change during `finish`. On recovery: tracked `state == 'completed'` →
   the write happened, mark the stage `completed`; tracked `state == 'active'` → it
   never happened, safe to (re)execute; anything else → ambiguous, `unknown`, block for
   reconciliation rather than guess. `current_step == transitionTarget` must not be used
   as a postcondition anywhere after this correction.
8. **`StepContext` gains `runtimeState`/`semanticStatus` (D37).** Computed by the same
   pure helper item 3 defines — never duplicating workflow sequencing logic (D10/D22
   principle, unchanged): `runtimeState: 'active' | 'completed'` and `semanticStatus:
   <resolved identifier>`, alongside the existing `currentStep` and other Task 08/D25
   fields. The terminal case (`currentStep: null`) still reports `stepStatus: 'complete'`
   as today; `semanticStatus` in that case is the final step's `status.completed` value.
9. **Migration of the four already-shipped one-step definitions and their templates
   (fail-closed, no silent default — same D33-D36 precedent as Task 09's own
   scope-amendments).** The four shipped definitions do **not** all share one step name:
   `standard`, `architectural`, and `small` each declare an `implementation` step
   (`implementation -> verified`); `exploratory` declares a `discovery` step
   (`discovery -> verified`, unaffected by D33's earlier terminal-target fix). Each
   gains `status` on its own actual step, using identifiers truthful to what that step
   does — never a copy-pasted pair that misdescribes it:
   - `standard` / `architectural` / `small` — `implementation: { status: { active:
     implementing, completed: implemented } }`.
   - `exploratory` — `discovery: { status: { active: discovering, completed:
     discovered } }`.

   These are the exact identifiers D37's own example specifies — mechanical, no wording
   judgment deferred, and no `refining`/`ready` pair introduced (the refine/spec-writing
   lifecycle remains a later, separate product extension). A
   definition missing `status` on any step fails to load from the moment this ships.

## Implementation constraints

- **Do not touch `gates/**`, `actions/**`, `contracts.mjs`, `registry.mjs`,
  `engine.mjs`, `errors.mjs`, `compatibility.mjs`, or `human-verification-store.mjs`** —
  this task is scoped to workflow-position/state semantics only, not gate/action/human-
  verification internals (all already correct after Task 08/09). See `forbidden_paths`.
- **Do not touch `.nevo-ai/workflows/**` beyond the exact-file `status` migration in item
  9** — no step renaming, no gate changes, no new steps. This task's own tests use
  fixture definitions constructed inline for every behavioral scenario; the shipped-file
  edits are the mechanical `status` addition only.
- **`step start`'s new mutation is not a durable multi-stage operation** — it is exactly
  one `setTaskWorkflowState` call, gated by the pure position resolution in item 3. Do
  not create a `.nevo-ai-local/...` record for it, and do not reuse the finish-operation
  record machinery (D14/D23) for activation — those exist for a materially different
  problem (a multi-stage, externally-side-effecting sequence), which activation is not.
- Preserve every existing Task 06/07/08/09 behavior and test that this correction does
  not itself change: `node --test tools/tests/workflow-next-step.test.mjs
  tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs
  tools/tests/workflow-e2e.test.mjs` must all still pass, with only the specific
  assertions that encoded the old immediate-advance behavior updated to the new
  active/completed model (do not delete or weaken unrelated assertions).
- Write `workflow_progress`/`task.status` exclusively through `setTaskWorkflowState`
  (D32, unchanged helper signature) — both the new `step start` activation path and
  `finish-operation.mjs`'s `update-task` stage. No direct `updateYamlFile` calls, no
  duplicated structural-YAML logic.
- `tools/specs/validation.mjs`'s `workflow_progress` schema validation gains `state`
  (required alongside `current_step` when `workflow_progress` is present) without
  weakening any existing check (the deterministic-mode-only fail-closed rule, D18's
  consequence, is unchanged and still applies to the whole `workflow_progress` block).
- The per-step `status` schema requirement (item 2) applies to every step in every
  workflow definition this loader validates — there is no "legacy" or "single-step"
  exemption; the migration (item 9) is how the existing shipped definitions stay valid,
  not a schema carve-out.
- `StepContext.runtimeState`/`semanticStatus` (item 8) are additive — every existing
  field `compileStepContext()` already returns keeps its shape and meaning.
- Update `docs/development/workflow-engine.md` wherever it currently documents `step
  start` as non-mutating or shows `finish` immediately advancing `current_step` in an
  example — this is a real, user-visible CLI behavior change.

## Acceptance criteria

1. **Fresh (case A):** no `workflow_progress` → `workflow step start` persists
   `current_step: entryStep, state: active` and returns that step's `StepContext` with
   `runtimeState: 'active'` and `semanticStatus` equal to the entry step's
   `status.active`. `automated: node --test tools/tests/workflow-next-step.test.mjs`
2. **Resume (case B), no duplicate mutation:** `current_step: A, state: active` →
   `workflow step start` returns the same `StepContext` for `A` without writing
   `change.yaml` again (asserted via a `change.yaml` mtime/content no-op check or an
   injected write-spy). `automated: node --test tools/tests/workflow-next-step.test.mjs`
3. **Internal completion:** `A` active → `workflow step finish` succeeds → `current_step`
   is still `A`, `state: completed`, `history` gains one entry `{ step: A, transitioned_to:
   B }`, `task.status` unchanged, `semanticStatus` resolves to `A`'s `status.completed`.
   `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
4. **Next start (case C):** continuing from AC3, `workflow step start` persists
   `current_step: B, state: active` (no new `history` entry), returns `B`'s
   `StepContext` with `semanticStatus` equal to `B`'s `status.active`. `automated: node --test tools/tests/workflow-next-step.test.mjs`
5. **Second step:** `B` active (from AC4) → `workflow step finish` succeeds → same
   shape as AC3, scoped to `B`. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
6. **Terminal:** the final step active → `workflow step finish` succeeds → atomically,
   in one write: `state: completed` on the final step, `history` gains the terminal
   entry, `task.status` = the declared terminal value; the next `workflow step start`
   reports the workflow already complete (case D) without consulting `task.status` to
   do so. `automated: node --test tools/tests/workflow-finish-operation.test.mjs, tools/tests/workflow-next-step.test.mjs`
7. **Completed-step retry:** a repeated `workflow step finish` against a step already
   `state: completed` (no intervening `step start`) returns an explicit
   `already-completed` result and never re-runs finalize actions or re-evaluates gates
   (verified via a call-count/spy on the finalize action). `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
8. **Crash reconciliation:** a persisted `update-task` operation intent with tracked
   `state: active` at the operation's step is reconciled as safe-to-redo; tracked
   `state: completed` is reconciled as already-done; an unrelated/ambiguous tracked
   state is reconciled as `unknown` and reported as reconciliation-required — `current_step
   == transitionTarget` is asserted nowhere in the implementation. `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
9. **Status derivation:** no `workflow_progress` → `new`; `state: active`/`state:
   completed` values resolve to the current step's own `status.active`/`status.completed`
   from the definition — verified against at least two steps with different declared
   `status` values to confirm the resolution is step-specific, not a constant.
   `automated: node --test tools/tests/workflow-next-step.test.mjs`
10. **Schema:** a step missing `status`, or declaring `status.active`/`status.completed`
    as empty/non-identifier values, fails `validateWorkflowDefinition`; a step declaring
    both fields as valid, distinct safe identifiers validates successfully.
    `automated: node --test tools/tests/workflow-next-step.test.mjs`
11. **Multi-step CLI E2E (fixture, ≥2 steps):** demonstrates the visible sequence `new ->
    active(A) -> completed(A) -> active(B) -> completed(B) -> ... -> terminal` driven
    entirely through `handleWorkflowStepStart`/`handleWorkflowStepFinish`, with no test
    calling an internal resolution function directly. `automated: node --test tools/tests/workflow-cli.test.mjs`
12. **Legacy coexistence:** legacy (non-`deterministic`-mode) workflow behavior is
    unaffected; `workflow_progress` (with or without `state`) remains forbidden on a
    non-deterministic-mode task exactly as today (D18's consequence, unchanged).
    `automated: node --test tools/tests/workflow-next-step.test.mjs`
13. **Migration:** `.nevo-ai/workflows/{standard,architectural,small}.yaml` and their
    matching templates each declare `status: { active: implementing, completed:
    implemented }` on their `implementation` step; `.nevo-ai/workflows/exploratory.yaml`
    and its template declare `status: { active: discovering, completed: discovered }`
    on their `discovery` step (not `implementation` — exploratory has no such step);
    all four load successfully under the corrected, `status`-requiring schema.
    `automated: node --test tools/tests/workflow-e2e.test.mjs, tools/tests/workflow-compatibility.test.mjs`
14. **Atomic task-state write, extended:** `setTaskWorkflowState` continues applying
    `status`/`workflowProgress` (now including `state`) in one `updateYamlFile` call —
    no regression to D32's atomicity guarantee. `automated: node --test tools/tests/store.test.mjs`
15. Every existing Task 06/07/08/09 test continues passing, with only the specific
    assertions that encoded the old immediate-advance-at-finish behavior updated to the
    new active/completed model. `automated: node --test tools/tests/workflow-next-step.test.mjs tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs tools/tests/workflow-e2e.test.mjs`
16. `docs/development/workflow-engine.md` reflects the corrected `step start`/`step
    finish` semantics (no stale immediate-advance example left as if current).
    `automated: node tools/docs.mjs check`
17. Full repository tool test suite plus specs/docs validate/check pass with zero
    failures. `automated: node --test tools/tests/*.test.mjs, node tools/specs.mjs validate, node tools/specs.mjs check, node tools/docs.mjs validate`

## Verification

```text
node --test tools/tests/workflow-next-step.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/workflow-cli.test.mjs
node --test tools/tests/workflow-e2e.test.mjs
node --test tools/tests/store.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs check
```

---
id: deterministic-status-architecture.workflow-definition-schema-extensions
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/step-executor-model.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/specs/workflow/definitions/schema.mjs
  - tools/specs/workflow/definitions/loader.mjs
  - .nevo-ai/workflows/standard.yaml
  - .nevo-ai/workflows/standard-v1.yaml
  - .nevo-ai/workflows/architectural.yaml
  - .nevo-ai/workflows/exploratory.yaml
  - .nevo-ai/workflows/small.yaml
  - tools/tests/workflow-definitions.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/specs/lifecycle-primitives.mjs
  - tools/dashboard/**
  - src/**
depends_on: [ status-vocabulary-extraction ]
semantic_references:
  decisions: [D6, D9]
---

# Task: Workflow definition schema extensions

## Goal

Add `executor: agent | human` per step, minimal transition `action` metadata (label,
feedback requirement, required for `executor: human` transitions), and a per-**transition**
`outcome: success | failure` field (only on transitions whose `to` targets a terminal
status) to the workflow definition schema — then migrate the five existing definitions per
the grounded, per-file audit in `owner-decisions.md` D6, not a blanket assumption.

## Dependencies

`status-vocabulary-extraction` — this task's `outcome`-field validation needs
`TERMINAL_STATUSES` (imported from the newly extracted `tools/specs/status-vocabulary.mjs`,
not `lifecycle-primitives.mjs`) to check whether a transition's `to` is terminal.

## Implementation constraints

- `tools/specs/workflow/definitions/schema.mjs`:
  - Add `executor` to the step schema: enum `agent`/`human`, defaults to `agent` when
    absent.
  - Add `transitions[].action`: `{ label: string, feedback?: { required: boolean } }`,
    optional for an `executor: agent` step's transitions. For an `executor: human` step,
    **every** transition must declare a non-empty `action.label` — validation error
    otherwise (item 6, cross-field validation). If `action.feedback` is present,
    `feedback.required` must be a boolean.
  - Add `transitions[].outcome`: enum `success`/`failure`. Required when that transition's
    `to` is a member of `TERMINAL_STATUSES` (imported from `status-vocabulary.mjs`);
    forbidden/ignored when `to` names a declared step (internal transition) — `outcome` has
    no meaning there and must not be silently accepted as a no-op field on an internal
    transition (fail validation if present on an internal transition, to avoid a
    silently-ignored typo).
  - **Do not** add any "terminal step" concept — this engine has none; every step declares
    `transitions`, and a transition's `to` alone determines internal-vs-terminal
    (`isStepName`/`TERMINAL_STATUSES` membership, already how `discriminateTarget` works).
  - **A human step's single unconditional transition needs no `value`/`result`** (D16, item
    7) — `action.label` is still required on it (cross-field validation above applies
    regardless of whether the step's transitions are conditional or not), but do not require
    or synthesize a `value` for it.
  - **`normalizeWorkflowDefinition()` must preserve the new fields (item 1).** Read directly
    (2026-09-19): it currently drops `executor` entirely, and its `transitions.map(...)`
    copies only `value`/`to`. Update it so the normalized step retains `executor` (when
    present) and the normalized transition retains `action`/`outcome` (when present),
    alongside the existing `value`/`to` — every runtime consumer reads the *normalized*
    object, never the raw parsed one, so a definition that validates must not lose this
    metadata here.
- Migrate `.nevo-ai/workflows/standard.yaml` and `.nevo-ai/workflows/standard-v1.yaml`
  (identical content): the `human-verification` step gets `executor: human`; its `pass`
  transition (`to: verified`) gets `action: {label: <e.g. Approve>}` and
  `outcome: success`; its `fail` transition (`to: implementation`, an internal transition)
  gets `action: {label: <e.g. Request changes>, feedback: {required: true}}` and **no**
  `outcome` (internal transition). The `implementation`/`review` steps in these two files
  are unaffected (no `executor` field — default `agent`); their own terminal-adjacent
  transitions are internal only, no `outcome` needed there either.
- Migrate `.nevo-ai/workflows/architectural.yaml`: its `implementation` step's single
  unconditional transition (`{to: verified}`) gets `outcome: success`. **No** `executor`
  field is added to this step (stays defaulted `agent`) and its
  `{type: human, required: true}` exit gate is untouched.
- Migrate `.nevo-ai/workflows/exploratory.yaml`: its `discovery` step's single unconditional
  transition (`{to: verified}`) gets `outcome: success`. **No** `executor` field; its human
  gate is untouched.
- Migrate `.nevo-ai/workflows/small.yaml`: its `implementation` step's single unconditional
  transition (`{to: verified}`) gets `outcome: success`. No `executor` field (this
  definition has no human involvement of any kind).
- Do not change any step's `id`, `purpose`, `expectedWork`, `hints`, `entryGates`, or
  `exitGates` — this task only adds the new fields described above.

## Acceptance criteria

- All five migrated definitions validate against the extended schema.
  `automated: node --test tools/tests/workflow-definitions.test.mjs`
- Only `standard.yaml`/`standard-v1.yaml`'s `human-verification` step carries
  `executor: human`; every other step across all five files has no `executor` field and
  defaults to `agent`. `automated: node --test tools/tests/workflow-definitions.test.mjs`
- Every current terminal transition (one per file: `human-verification`'s `pass→verified`
  in `standard`/`standard-v1`; `implementation`'s `→verified` in `architectural`/`small`;
  `discovery`'s `→verified` in `exploratory`) carries `outcome: success`. No internal
  transition in any of the five files carries an `outcome` field.
  `automated: node --test tools/tests/workflow-definitions.test.mjs`
- `architectural.yaml`'s and `exploratory.yaml`'s `{type: human, required: true}` exit gates
  are byte-for-byte unchanged. `inspection: diff both files' exitGates blocks against their pre-task content`
- A newly authored definition with an `executor: human` step whose transition lacks
  `action.label` fails validation. A newly authored definition with a transition targeting
  a terminal status but no `outcome` fails validation. A newly authored definition with
  `outcome` declared on an internal (step-targeting) transition fails validation.
  `automated: node --test tools/tests/workflow-definitions.test.mjs`
- Existing workflow-engine tests that load these five definitions (`workflow-e2e.test.mjs`,
  `workflow-multi-step-e2e.test.mjs`, `workflow-step-runner.test.mjs`) continue passing
  unchanged — proving the migration is additive, not behavior-changing for the engine's
  existing transition-resolution logic.
  `automated: node --test tools/tests/workflow-e2e.test.mjs tools/tests/workflow-multi-step-e2e.test.mjs tools/tests/workflow-step-runner.test.mjs`
- The object returned by `parseWorkflowDefinition()` **and** `loadWorkflowDefinition()` (not
  merely `validateWorkflowDefinition()`'s boolean result) carries `executor: 'human'` on
  `standard`/`standard-v1`'s normalized `human-verification` step, and `action`/`outcome` on
  its normalized transitions — regression-tested against the actual returned object, not
  just schema-validation success. `automated: node --test tools/tests/workflow-definitions.test.mjs`
- `human-verification`'s single-unconditional-transition sibling case (a hypothetical human
  step with one unconditional transition) validates without requiring a `value`, and its
  normalized transition has no fabricated `value` field.
  `automated: node --test tools/tests/workflow-definitions.test.mjs`

## Verification

```bash
node --test tools/tests/workflow-definitions.test.mjs
node --test tools/tests/workflow-e2e.test.mjs
node --test tools/tests/workflow-multi-step-e2e.test.mjs
node --test tools/tests/workflow-step-runner.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The engine's transition-resolution logic itself (unchanged — it stays generic and must
never branch on the literal label/purpose text this task adds). The executor-invariant
guard that reads this schema (task `step-executor-guard`). The human-step execution
operations that reuse `action`/`outcome` (task `human-step-execution-operations`). The
projections that read `action`/`outcome` (tasks `human-step-projection`,
`deterministic-dependency-satisfaction`). Converting any `type: human` gate into a
human-owned step (explicitly not done here, per D6).

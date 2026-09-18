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
  - .nevo-ai/workflows/exploratory.yaml
  - .nevo-ai/workflows/architectural.yaml
  - .nevo-ai/workflows/small.yaml
  - .nevo-ai/workflows/standard-v1.yaml
  - .nevo-ai/workflows/standard.yaml
  - tools/tests/workflow-definitions.test.mjs
forbidden_paths:
  - tools/specs/approve/**
  - tools/specs/start/**
  - tools/specs/complete/**
  - tools/specs/verify/**
  - tools/specs/lifecycle-primitives.mjs
  - tools/dashboard/**
  - src/**
semantic_references:
  decisions: [D6, D9]
---

# Task: Workflow definition schema extensions

## Goal

Add `executor: agent | human` per step, minimal transition `action` metadata (label,
feedback requirement), and a terminal-step `outcome: success | failure` field to the
workflow definition schema, and migrate all five existing definitions to use them —
per D6/D9, the smallest bounded, explicit migration, not an inferred default for the
human-owned/success-terminal steps specifically.

## Implementation constraints

- `tools/specs/workflow/definitions/schema.mjs`: add `executor` (enum `agent`/`human`,
  default `agent` when absent — existing agent-only steps need no edit), `transitions[].action`
  (`{ label: string, feedback?: { required: boolean } }`, optional/additive), and a
  terminal-step `outcome` (enum `success`/`failure`) — required on any step with no
  `transitions` in a *newly authored* definition (validation error if absent), present on
  all five existing definitions after this task's migration.
- `tools/specs/workflow/definitions/loader.mjs`: no structural change expected beyond
  whatever the schema addition requires it to pass through unmodified.
- Migrate each of the five `.nevo-ai/workflows/*.yaml` files: set `executor: human` on the
  definition's human-owned step (today's `human-verification`-named step or equivalent);
  add `action` metadata to that step's transitions (e.g. `pass` → `{ label: Approve }`,
  `fail` → `{ label: Request changes, feedback: { required: true } }` — adapt to each
  definition's actual transition `value`s); set `outcome: success` on the definition's
  successful terminal step (today's `verified`-equivalent) and `outcome: failure` on any
  other terminal step the definition defines.
- Do not change any step's `id`, `purpose`, `expectedWork`, `hints`, `entryGates`, or
  `exitGates` — this task only adds the three new fields.

## Acceptance criteria

- All five migrated definitions validate against the extended schema.
  `automated: node --test tools/tests/workflow-definitions.test.mjs`
- Each definition's human-owned step carries `executor: human` and correct `action` metadata
  on its transitions; every other step defaults to `executor: agent` (absent in the YAML).
  `automated: node --test tools/tests/workflow-definitions.test.mjs`
- Each definition's successful terminal step carries `outcome: success`; any other terminal
  step carries `outcome: failure`. `automated: node --test tools/tests/workflow-definitions.test.mjs`
- A newly authored definition with a terminal step and no `outcome` field fails validation
  with a clear error naming the missing field.
  `automated: node --test tools/tests/workflow-definitions.test.mjs`
- Existing workflow-engine tests that load these five definitions
  (`workflow-e2e.test.mjs`, `workflow-multi-step-e2e.test.mjs`,
  `workflow-step-runner.test.mjs`) continue passing unchanged — proving the migration is
  additive, not behavior-changing for the engine's existing transition-resolution logic.
  `automated: node --test tools/tests/workflow-e2e.test.mjs tools/tests/workflow-multi-step-e2e.test.mjs tools/tests/workflow-step-runner.test.mjs`

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
guard that reads this schema (task `step-executor-guard`). The projections that read
`action`/`outcome` (tasks `human-step-projection`, `deterministic-dependency-satisfaction`).

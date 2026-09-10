---
id: deterministic-workflow-foundation.fail-closed-workflow-definition-resolution
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/multi-step-workflow-orchestration.md
    - tools/specs/workflow/step-context.mjs
    - tools/specs/workflow/definitions/loader.mjs
    - tools/specs/workflow/definitions/schema.mjs
    - tools/specs/workflow/registry.mjs
  optional:
    - .nevo-ai/workflows/standard.yaml
allowed_paths:
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/definitions/loader.mjs
  - tools/specs/workflow/definitions/schema.mjs
  - .nevo-ai/workflows/standard.yaml
  - tools/tests/workflow-next-step.test.mjs
  - tools/tests/workflow-finish-operation.test.mjs
  - tools/tests/workflow-cli.test.mjs
  - tools/tests/workflow-e2e.test.mjs
  - tools/tests/workflow-compatibility.test.mjs
  - .nevo-ai/workflows/architectural.yaml
  - .nevo-ai/workflows/small.yaml
  - .nevo-ai/workflows/exploratory.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
semantic_references:
  decisions: [D2, D7, D20, D34, D35]
  constraints: [C6, C9, C20]
  dependency_contracts: [multi-step-workflow-progression]
---

# Task: Fail-closed workflow definition/action/gate resolution

## Goal

Close the one remaining silent-degradation path in the engine (D20,
`areas/multi-step-workflow-orchestration.md` §4): a workflow definition referencing an
action id with no registered `ActionContract` currently disappears silently from
execution instead of failing closed.

1. Remove `step-context.mjs`'s `registeredFinalizeActions` tolerant filter —
   `aggregateFinalizeCheck` passes the full, unfiltered `finalize`/`actions` list to
   `WorkflowEngine.checkStep`.
2. Make `loadWorkflowDefinition` (`definitions/loader.mjs`) call
   `validateWorkflowDefinition` with `knownActions` populated from the real,
   already-registered `ActionRegistry` (`defaultActionRegistry.list()`), so an
   unregistered action id fails validation at **load time** — the caller must ensure
   action registration (`actions/index.mjs`'s side effect) has already run before
   calling `loadWorkflowDefinition`; document this ordering requirement where the loader
   is called from `tools/specs/workflow/cli.mjs`.
3. Remove `verify-task-output` from `.nevo-ai/workflows/standard.yaml`'s `finalize`
   list — it has no registered implementation and was only ever tolerated by the filter
   this task removes.

## Implementation constraints

- Gate types are already validated at schema-load time (`KNOWN_GATE_TYPES` in
  `definitions/schema.mjs`) — do not duplicate that check; this task's scope is the
  action-reference side only, which had no equivalent enforcement.
- After removing the tolerant filter, `WorkflowEngine.checkStep`'s own existing
  behavior (`ActionRegistry.require` throwing `WorkflowError: Unknown action '...'`,
  Task 03) becomes the enforcement mechanism for any action reference that somehow still
  reaches aggregation unregistered — this task does not need to add a second check
  inside `checkStep` itself, only stop suppressing that error upstream.
- Any test fixture workflow definition (in `workflow-next-step.test.mjs`,
  `workflow-finish-operation.test.mjs`, `workflow-cli.test.mjs`, `workflow-e2e.test.mjs`)
  that referenced `verify-task-output` for illustrative purposes must drop it — those
  fixtures were written before this decision and would now fail to load/aggregate.
- Do not implement a real `verify-task-output` action in this task — removal is the
  chosen fix (D20); implementing one is explicitly out of scope here and left for a
  future task if ever needed.
- This task depends on Task 08 (touches the same `step-context.mjs`
  `aggregateFinalizeCheck` and the same test files) — rebase/verify against Task 08's
  generalized resolution rather than reintroducing the single-step assumption.

## Acceptance criteria

1. `aggregateFinalizeCheck` no longer filters finalize/action entries by registration
   status — every declared action is included in the `WorkflowEngine.checkStep`
   aggregation. `automated: node --test tools/tests/workflow-next-step.test.mjs`
2. `loadWorkflowDefinition` rejects a definition referencing an unregistered action id
   with an explicit, load-time error naming the unknown action — never a workflow that
   loads successfully and silently runs with fewer declared actions. `automated: node --test tools/tests/workflow-next-step.test.mjs`
3. `.nevo-ai/workflows/standard.yaml` no longer references `verify-task-output`; it
   loads and its one step's finalize sequence (`commit-and-push`) executes exactly as
   before this change. `automated: node --test tools/tests/workflow-e2e.test.mjs`
4. Every fixture workflow definition across the existing Task 06/07/08 test files loads
   cleanly under the new fail-closed validation (none references an unregistered
   action). `automated: node --test tools/tests/*.test.mjs`
5. A definition referencing an unregistered gate type still fails exactly as before
   (regression check only — this was already enforced pre-existing schema validation,
   not newly added by this task). `automated: node --test tools/tests/workflow-next-step.test.mjs`
6. Full test suite passes. `automated: node --test tools/tests/*.test.mjs`

## Verification

```text
node --test tools/tests/workflow-next-step.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
```

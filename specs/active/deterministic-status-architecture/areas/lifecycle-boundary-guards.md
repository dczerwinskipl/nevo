# Area: Lifecycle boundary guards

## Responsibility

Make `workflow.mode` a hard lifecycle boundary: every legacy mutating command refuses to run
against a deterministic spec, every deterministic mutating command refuses to run against a
legacy spec, both before any state write — and keep that guarantee true structurally
(no importable path from one lifecycle's mutation code to the other's) rather than by
convention.

## Current state

`resolveWorkflowMode(change, options)` (`tools/specs/workflow/compatibility.mjs`) already
correctly classifies a spec as `legacy` (default, including when `workflow` is absent) or
`deterministic`, and throws on ambiguous config. It is consumed today only by
`resolveWorkflowRuntime()` in `tools/specs/workflow/cli.mjs` — the deterministic `workflow`
CLI subtree. `approve`/`start`/`complete`/`verify` (`tools/specs/{approve,start,complete,
verify}/operation.mjs`) never call it and have no cross-mode awareness at all. No import-
boundary regression test exists.

## Requirements

- `approve`/`start`/`complete`/`verify` each call `resolveWorkflowMode()` (or an equivalent
  read-only classification) before their first state mutation, and fail with a clear error
  naming the spec as deterministic and pointing at the deterministic command surface
  (`workflow task publish`, `workflow step start`, `workflow step finish`,
  `workflow verify-human`) when the spec resolves to deterministic.
- `workflow step start`/`workflow step finish`/`workflow verify-human` (and the new
  `workflow task publish`, area `deterministic-task-publish`) fail with a clear error naming
  the spec as legacy and pointing at `approve`/`start`/`complete`/`verify` when the spec
  resolves to legacy.
- Every guard check happens strictly before any write — a failing guard must leave
  `change.yaml` byte-for-byte unchanged.
- No shared function implements both directions' mutation logic behind an `if legacy /
  if deterministic` branch. Each command's own guard call is a small, local addition to its
  existing operation module.

## Constraints

- Do not change any legacy command's behavior for a legacy spec, or any deterministic
  command's behavior for a deterministic spec — this area only adds a new failure path for
  the cross-mode case.
- `resolveWorkflowMode()` (`tools/specs/workflow/compatibility.mjs`), the generic,
  semantics-free store writers (`setTaskStatus`/`setTaskWorkflowState` in
  `tools/specs/store.mjs`), and the extracted `tools/specs/status-vocabulary.mjs`
  (`areas/shared-status-vocabulary.md`) are the only shared, low-level utilities either
  direction may import. Per D8, `tools/specs/lifecycle-primitives.mjs` itself is **not**
  exempt — it is a legacy-semantics module (`isTaskReady`, `DEPENDENCY_SATISFYING_STATUSES`,
  `TRANSITIONS`, `depsSatisfied`), and no deterministic mutation or projection code in this
  change may import it. Legacy code's own use of it, including its re-export of the
  extracted vocabulary, is unaffected.

## Interfaces and boundaries

Exposes: no new public interface — each of the four legacy operations and each of the
deterministic mutation entry points gains an internal guard call.

Consumed by: every other area in this change assumes these guards exist and are enforced
before any of their own new operations run.

## Area-specific acceptance criteria

- Running `approve`/`start`/`complete`/`verify` against a deterministic spec fails with a
  clear, deterministic-aware error, and leaves **all** of the following unchanged: the
  manifest (`change.yaml`, byte-for-byte), git `HEAD`, the current branch (no new branch
  created), the working tree, and any workflow-operation/runtime state (no
  `workflow_progress`, no execution session) — not just `change.yaml` in isolation.
- Running `workflow step start`/`workflow step finish`/`workflow verify-human` against a
  legacy spec fails with a clear, legacy-aware error, verified against the same full set of
  side effects above.
- A spec with no `workflow` field, and a spec with explicit `workflow.mode: legacy`, behave
  exactly as before this change for all four legacy commands.
- Static analysis (or an equivalent regression test) confirms: no file under
  `tools/specs/{approve,start,complete,verify}/**` imports from `tools/specs/workflow/**`'s
  mutation modules; no file under `tools/specs/workflow/**`'s mutation or projection modules
  imports from `tools/specs/{approve,start,complete,verify}/**`; and no file under
  `tools/specs/workflow/**` imports `tools/specs/lifecycle-primitives.mjs` at all (D8).

## Dependencies

`areas/shared-status-vocabulary.md` (the import-boundary regression test's own
"no `lifecycle-primitives.mjs` import" check can only pass once that area's extraction task
has actually removed the two pre-existing imports — see D8). Otherwise this is the
foundation area every other area's guard-respecting operations build on.

## Out of scope

The new `workflow task publish` operation's own validation logic (area
`deterministic-task-publish` owns it; this area only requires that operation to reuse the
same guard pattern). Any change to legacy or deterministic *successful*-path behavior.

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
- `resolveWorkflowMode()` itself is the one shared, low-level, read-only utility both
  directions may import — it is not a mutation operation and importing it does not violate
  the "no cross-lifecycle mutation import" rule enforced by this area's regression test.

## Interfaces and boundaries

Exposes: no new public interface — each of the four legacy operations and each of the
deterministic mutation entry points gains an internal guard call.

Consumed by: every other area in this change assumes these guards exist and are enforced
before any of their own new operations run.

## Area-specific acceptance criteria

- Running `approve`/`start`/`complete`/`verify` against a deterministic spec fails with a
  clear, deterministic-aware error and leaves `change.yaml` unchanged.
- Running `workflow step start`/`workflow step finish`/`workflow verify-human` against a
  legacy spec fails with a clear, legacy-aware error and leaves `change.yaml` unchanged.
- A spec with no `workflow` field, and a spec with explicit `workflow.mode: legacy`, behave
  exactly as before this change for all four legacy commands.
- Static analysis (or an equivalent regression test) confirms no file under
  `tools/specs/{approve,start,complete,verify}/**` imports from
  `tools/specs/workflow/**`'s mutation modules, and no file under
  `tools/specs/workflow/**`'s mutation modules imports from
  `tools/specs/{approve,start,complete,verify}/**`.

## Dependencies

None — this is the foundation area every other area's guard-respecting operations build on.

## Out of scope

The new `workflow task publish` operation's own validation logic (area
`deterministic-task-publish` owns it; this area only requires that operation to reuse the
same guard pattern). Any change to legacy or deterministic *successful*-path behavior.

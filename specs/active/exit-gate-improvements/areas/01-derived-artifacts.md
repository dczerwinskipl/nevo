# Area A — Derived-artifact ownership

## Responsibility

Make deterministic workflow infrastructure — not agents, tasks or humans — the sole
writer of tracked generated artifacts as part of the same transaction that mutates their
sources.

## Current state

See `discovery.md` § "Mutation and generation inventory". The engine never regenerates;
only legacy lifecycle ops do; the docs generator is non-idempotent.

## Requirements

1. A static generator registry (`tools/specs/derived/`) with `inputs` globs, exact
   `outputs`, `sync`, `check`.
2. Selective planning: only generators whose inputs intersect this operation's changed
   paths run.
3. `syncDerivedArtifacts` is the single entry point, invoked from `finishStep`
   (`ensureCommit`), `batch finish` stage 5 and `task publish`; never from `step start`,
   `--check`, or context compilation.
4. Ownership = exact output paths of generators that ran; no change to `allowed_paths`
   semantics, no generic bypass. For `batch finish` stage 5, staging ownership is explicitly
   constrained to `(∪ allowed_paths) ∪ workflowOwnedPaths ∪ derivedOwnedPaths`, replacing the
   unconstrained default `include: ['*']`.
5. Preconditions: refuse when a dirty path matching a triggered generator's inputs is not
   part of the operation's commit set (`DERIVED_INPUT_DIRTY_OUTSIDE_OPERATION`).
6. Integrity validation: in-process `check()` verifies generated outputs (`DERIVED_INTEGRITY_FAILED`).
   Per D5, repo-wide `validateSpecs`/`validateDocs` runs in-process (`REPO_INTEGRITY_FAILED`).
   *Architectural Note on D5:* Unrelated repository validation failures block all finish operations
   including `review fail`. Trade-offs between absolute repo health and change isolation are documented
   in `overview.md` § "Integrity validation".
7. Errors are typed `WorkflowError`s thrown before the commit stage records `intent`.
8. Idempotent: unchanged inputs ⇒ byte-identical outputs and no git diff, including the
   docs index timestamps.

## Interfaces and boundaries

- Consumes: `buildSpecsIndexes`/`writeSpecsIndexes`/`checkSpecsIndexes`
  (`tools/specs/indexes.mjs`), `buildDocsIndexes`/`writeDocsIndexes`/`checkDocsIndexes`/
  routing builders (`tools/docs/service.mjs`).
- Exposes: `planDerivedSync`, `syncDerivedArtifacts`, `resolveDerivedOwnedPaths`,
  `listDerivedOutputs`.
- Consumed by: `finish-operation.mjs`, `commit-and-push.mjs` (scope check),
  `execution-settlement.mjs` (diagnostics), `batch-finish`, `publish`.

## Area-specific acceptance criteria

See change-wide criteria 1–9, 12 in `overview.md`.

## Dependencies

None on Area B.

## Out of scope

Migrating legacy lifecycle operations; changing CI.

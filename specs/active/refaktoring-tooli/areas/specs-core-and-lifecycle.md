---
id: refaktoring-tooli.area.specs-core-and-lifecycle
type: area
change: refaktoring-tooli
---

# Area: Specs Core and Lifecycle

## Responsibility

Owns the core specification domain logic, task lifecycle state machines, workflow gate evaluations, postcondition inspection, recovery algorithms, batch selection, provenance mapping, and specification filesystem persistence.

## Current state

- `tools/specs/lifecycle.mjs` (1745 LOC) is an oversized module mixing disparate algorithms (branch inspection, transition rules, batch validation, provenance analysis, stage derivation).
- `tools/specs/service.mjs` (1042 LOC) bundles file I/O, index generation, fingerprint calculations, follow-up tracking, and context packet generation.
- Both files violate single responsibility and module sizing guidelines (§3 and §4 of `node-tooling-guidelines.md`).

## Requirements

- Decompose `tools/specs/lifecycle.mjs` into focused domain capability modules under `tools/specs/lifecycle/`:
  - `tools/specs/lifecycle/transitions.mjs` — task and change status transition validation, dependency checks, and gate evaluation.
  - `tools/specs/lifecycle/recovery.mjs` — postcondition inspection algorithms (`inspectStartPostconditions`, `inspectApprovePostconditions`) and recovery scenario handling (REC-xx).
  - `tools/specs/lifecycle/batch.mjs` — batch selection logic (`selectBatch`), progress derivation (`deriveBatchProgress`), and validation checkpoints.
  - `tools/specs/lifecycle/provenance.mjs` — changed path attribution (`attributeTouchedPaths`, `resolveProvenanceMappings`), overlap detection, and baselines.
  - `tools/specs/lifecycle/stage.mjs` — pure stage derivation (`deriveStage`).
  - `tools/specs/lifecycle/review.mjs` — review scopes, batch review verdicts, and risk detection.
- Decompose `tools/specs/service.mjs` into dedicated capability modules:
  - `tools/specs/store/change-store.mjs` — change and task loading, discovery, and updates (`loadChange`, `listChanges`, `setTaskStatus`).
  - `tools/specs/fingerprint.mjs` — deterministic fingerprint calculations for specifications and tasks.
  - `tools/specs/indexes.mjs` — generation, persistence, and verification of specification indexes.
  - `tools/specs/context.mjs` — task context packet assembly (`buildContextPacket`, `getNext`).
  - `tools/specs/follow-ups.mjs` — parsing, updating, and resolving follow-up entries in `follow-ups.yaml`.
  - `tools/specs/batch-store.mjs` — batch intent state persistence (`loadBatchIntent`, `writeBatchIntent`, `clearBatchIntent`).
- Preserve `lifecycle.mjs` and `service.mjs` as backward-compatible re-export entrypoints or update imports directly to new modules.
- Ensure all deterministic decision logic remains strictly separated from external I/O effects (§6 of `node-tooling-guidelines.md`).

## Interfaces and boundaries

Modules in this area serve as the domain core for both the CLI and the dashboard server. They avoid writing directly to console (`console.log`, `process.exit`), returning structured results or throwing domain errors instead.

## Area-specific acceptance criteria

1. No newly created module in `tools/specs/lifecycle/` or `tools/specs/` exceeds ~300–400 LOC.
2. Pure decision logic (e.g. transition rules, fingerprinting) is 100% unit-testable without filesystem side effects.
3. All specification tests under `tools/tests/specs/` pass cleanly.

## Out of scope

- Altering task status semantics or workflow acceptance gate criteria.

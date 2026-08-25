---
id: refaktoring-tooli.area.specs-core-and-lifecycle
type: area
change: refaktoring-tooli
---

# Area: Specs Core and Lifecycle

## Responsibility

Owns the core specification domain logic, task lifecycle state machines, workflow gate evaluations, postcondition inspection, recovery algorithms, batch selection, and specification filesystem persistence.

## Current state

- `tools/specs/lifecycle.mjs` combines multiple distinct capabilities (transition rules, recovery inspection, batch selection, provenance mapping, and stage derivation).
- `tools/specs/service.mjs` acts as a monolithic catch-all module combining file persistence, fingerprinting, indexes, context packets, and follow-ups.
- Decision algorithms are coupled with file I/O, reducing unit testability.

## Requirements

- Decompose lifecycle capabilities by responsibility:
  - Transition validation and dependency checking.
  - Postcondition inspection algorithms (`inspectStartPostconditions`, `inspectApprovePostconditions`) and recovery handling.
  - Batch selection logic and progress derivation.
  - Changed path attribution and provenance mapping.
  - Pure stage derivation.
- Decompose storage and helper capabilities:
  - Change and task filesystem persistence.
  - Pure fingerprint calculations.
  - Specification index generation and verification.
  - Task context packet construction.
  - Follow-up ledger persistence in `follow-ups.yaml`.
- Ensure gate evaluations (`tools/specs/gates.mjs` / lifecycle rules) are directly exportable as shared application operations, reusable by both CLI and dashboard server without spawning subprocesses.
- Preserve backward-compatible re-exports in `lifecycle.mjs` and `service.mjs` to ensure import stability across existing callers.

## Interfaces and boundaries

Modules in this area serve as the domain core for both the CLI and the dashboard server. They avoid writing directly to console (`console.log`, `process.exit`), returning structured results or throwing domain errors instead.

## Area-specific acceptance criteria

1. Pure decision logic (e.g. transition rules, fingerprinting, postcondition recovery) is decoupled from filesystem/Git side effects and unit tested.
2. Gate evaluation functions can be imported and executed in-process by server code without spawning child CLI processes.
3. All specification lifecycle and validation tests pass cleanly.

## Out of scope

- Altering task status semantics or workflow acceptance gate criteria.

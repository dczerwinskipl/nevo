---
id: refaktoring-tooli.specs-lifecycle-capabilities-and-decision-logic
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/specs-core-and-lifecycle.md
    - docs/development/node-tooling-guidelines.md
    - tools/specs/lifecycle.mjs
    - tools/specs/service.mjs
    - tools/specs/lifecycle-primitives.mjs
    - tools/specs/gates.mjs
    - tools/specs/validation.mjs
  optional: []
allowed_paths:
  - tools/specs/**
  - tools/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D3]
  constraints: [C1, C2, C4, C6]
---

# Task: Specs lifecycle capabilities and decision logic

## Goal

Separate pure deterministic decision logic from external filesystem/Git I/O across specification lifecycle and storage modules, decomposing `tools/specs/lifecycle.mjs` and `tools/specs/service.mjs` by cohesive capability and migrating internal callers.

## Problem

- `tools/specs/lifecycle.mjs` acts as a monolithic file bundling multiple distinct capabilities: transition rules, postcondition inspection, recovery handling, batch selection, provenance mapping, and stage derivation.
- `tools/specs/service.mjs` acts as a generic capability bag combining file persistence, fingerprinting, indexes, context packets, and follow-ups.
- Deterministic decision logic is interwoven with file reading and Git queries, making unit testing slower and requiring wider mocks (§3, §5, §6 of `node-tooling-guidelines.md`).

## Expected outcome

- Pure decision algorithms (e.g. transition validation, postcondition recovery inspection, fingerprinting, stage derivation, batch progress calculation) are decoupled into focused capability modules and covered by pure unit tests.
- Filesystem persistence, index generation, and context packet generation are grouped into cohesive capability modules.
- Internal callers are migrated directly to newly separated capability modules; compatibility re-exports are retained only where real external callers or public tooling interfaces require them, eliminating unnecessary forwarding layers.

## Preserved contracts & behavior

- All public CLI commands, exit codes, and validation invariants must remain unchanged.
- All active and archived specifications must continue to validate cleanly with `node tools/specs.mjs validate`.

## Verification

```text
node --test tools/tests/task-lifecycle.test.mjs tools/tests/gates.test.mjs tools/tests/workflow-*.test.mjs tools/tests/recovery.test.mjs
node tools/specs.mjs validate
```

## Out of scope

- Changing workflow status definitions or gate condition logic.

---
id: activity-core-model-and-contracts
status: draft
change: ai-spec-history
context:
  required:
    - specs/active/ai-spec-history/overview.md
    - specs/active/ai-spec-history/areas/activity-model-and-store.md
    - specs/active/ai-spec-history/owner-decisions.md
allowed_paths:
  - tools/specs/activity/model.mjs
  - tools/tests/activity-model.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
  - tools/specs/workflow/**
semantic_references:
  decisions: [D5, D7]
---

# Task: Activity core model and contracts

## Goal

Define the core `Activity` envelope type and its validator — the stable, minimal schema
every activity record must satisfy — without any persistence or producer-specific logic.

## Requirements

- `tools/specs/activity/model.mjs` exports:
  - `ACTIVITY_SCHEMA_VERSION` (currently `1`).
  - A validator (e.g. `validateActivityEnvelope(record)`) that checks required fields
    (`id`, `type`, `schemaVersion`, `occurredAt`, `actor`, `scope.specId`) and the shape
    of optional fields (`initiatedBy`, `triggeredBy`, `scope.taskId`, `data`).
    **This validator never defaults, generates, or mutates any field** — it only ever
    receives and checks an already-complete envelope. Defaulting/generating `id`,
    `occurredAt`, and `schemaVersion` is task 02's (`recordActivity`'s) responsibility,
    applied *before* this validator runs (2026-09-16 review, Major 4 — task 01 and task 02
    previously disagreed about which of them owns this).
  - `data` is validated only for being present-or-absent — its internal shape is
    explicitly out of scope for this validator (producer-owned, D7).
  - An `ActorRef` shape check (`{ type: string, id: string }`), with `type` accepting any
    string — do not hardcode a closed enum of actor types.
- `type` values are free-form namespaced strings (e.g. `workflow.step.completed`) — the
  validator must not maintain or check against a closed list of known types (this is the
  extensibility mechanism, D7).

## Implementation constraints

Pure functions/types only — no file I/O, no `crypto.randomUUID()` calls beyond what a
caller might use to build a record before validating it. This module must remain usable
by any future producer without importing workflow- or dashboard-specific code.

## Acceptance criteria

- A minimal valid record (only required fields) passes validation.
- A record missing `actor`, `scope.specId`, `type`, or `occurredAt` fails validation with
  a clear error identifying the missing field. `automated: node --test tools/tests/activity-model.test.mjs`
- A record with an arbitrary/new `type` string (not one used elsewhere in the codebase)
  passes validation unchanged — proves the schema doesn't enumerate types.
  `automated: node --test tools/tests/activity-model.test.mjs`
- A record with both `initiatedBy` and `triggeredBy` set, and a record with neither set,
  both pass validation. `automated: node --test tools/tests/activity-model.test.mjs`

## Verification

```bash
node --test tools/tests/activity-model.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Persistence (task 02), actor resolution (task 03), and any specific producer's `data`
contract (tasks 06–07).

---
id: activity-adr-and-docs
status: draft
change: ai-spec-history
context:
  required:
    - specs/active/ai-spec-history/overview.md
    - specs/active/ai-spec-history/owner-decisions.md
    - docs/decisions/ADR-0004-review-artifacts-and-handoff.md
    - docs/decisions/ADR-0006-process-continuity-and-hardening.md
    - docs/development/workflow-engine.md
allowed_paths:
  - docs/decisions/ADR-0009-local-append-only-activity-history.md
  - docs/development/workflow-engine.md
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
forbidden_paths:
  - src/**
  - tools/**
semantic_references:
  decisions: [D9]
  dependency_contracts:
    - activity-dashboard-api
    - workflow-step-activity-producer
    - human-verification-activity-producer
---

# Task: ADR and documentation

## Dependencies

`activity-dashboard-api`, `workflow-step-activity-producer`,
`human-verification-activity-producer` — written last, once the shape actually built is
known.

## Goal

Record the durable architectural decision behind this change as a new ADR, and update
`docs/development/workflow-engine.md`'s `.nevo-ai-local` runtime-storage listing to
include the new Activity store, so the doc doesn't go stale on merge.

## Requirements

- `docs/decisions/ADR-0009-local-append-only-activity-history.md`: explain why a local,
  append-only Activity ledger for `.nevo-ai-local` runtime facts (actor, session, attempt)
  is not a repeat of the pattern ADR-0004/ADR-0006 rejected — those applied to
  **git-tracked** artifacts, where git already substitutes for history; `.nevo-ai-local`
  is git-ignored, so git captures nothing about this runtime state. Record the
  append-only/no-pruning/namespaced-per-producer-type design as the decision future
  producers must follow (D9).
- Update `docs/development/workflow-engine.md`'s "Attempt-scoped runtime storage" section
  (around the existing `.nevo-ai-local/workflow-operations/...` and
  `.nevo-ai-local/human-verifications/...` bullets) to add the new
  `.nevo-ai-local/activity/<specId>.ndjson` store, noting it is per-spec (not
  attempt-scoped) and has no pruning.
- Run `node tools/docs.mjs generate` (or the project's equivalent) so
  `docs/index.generated.*`/`docs/routing.generated.json` reflect the new/changed docs.

## Acceptance criteria

- `node tools/docs.mjs validate` passes with the new ADR and updated doc.
  `automated: node tools/docs.mjs validate`
- The ADR explicitly names ADR-0004 and ADR-0006 and states the git-tracked-vs-git-ignored
  distinction (`inspection: confirm both ADR numbers and the distinction are named in the
  new ADR's text`).
- `docs/development/workflow-engine.md` lists the new activity store path alongside the
  existing two `.nevo-ai-local` bullets (`inspection: confirm the new bullet is present`).

## Verification

```bash
node tools/docs.mjs validate
node tools/specs.mjs validate
node tools/specs.mjs check
```

## Out of scope

Any further doc updates beyond the ADR and the one workflow-engine.md section.

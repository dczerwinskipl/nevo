---
id: admission-ownership-model-adr
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/owner-decisions.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/agent-admission-and-activation-readiness.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/terminal-execution-classification-and-resumability.md
  optional:
    - docs/decisions/ADR-0003-technical-decision-triage-and-option-analysis.md
depends_on:
  - non-fatal-admission-for-remediable-blockers
  - terminal-reconciliation-adopts-outcome
  - dependency-consumption-idempotent-on-resume
  - shared-finish-operation-replayability-classifier
allowed_paths:
  - docs/decisions/**
forbidden_paths:
  - tools/**
  - src/**
semantic_references:
  decisions: [D1, D2, D3, D4, D5, D6]
  dependency_contracts: [non-fatal-admission-for-remediable-blockers, terminal-reconciliation-adopts-outcome, dependency-consumption-idempotent-on-resume, shared-finish-operation-replayability-classifier]
---

# Task: Admission/ownership model ADR

## Goal

Write the ADR documenting the design this specification implements, since no ADR exists
today for admission/ownership/settlement as a whole (confirmed gap — zero matches in
`docs/decisions/` for these terms). Document, as durable decisions future changes need to
know about: the three-layer separation (session/turn admission vs. execution ownership vs.
workflow step readiness); "ownership belongs to the live execution/turn, not the workflow
attempt"; the broadened `resumable` semantic (D1 amendment — "safely ended, legal work
remains," not just "attempt mid-flight"); the shared finish-operation-replayability
classifier and the symmetry it enforces (D2 amendment) — the identical semantic rule
governs both admitting a new execution against an existing finish-operation record *and*
classifying a terminating execution that left one behind, via one shared helper rather than
two independently-evolving checks; and the three-outcome terminal classification
(`completed | resumable | recovery-required`) with no new persistent claim status.

## Implementation constraints

- Follow this repository's existing ADR format/numbering convention (read at least one
  existing ADR under `docs/decisions/` for shape before writing).
- Document what was **not** chosen and why (explicit takeover acknowledgement, a new
  persisted `resumable` claim status, duplicating the replayability check separately in
  admission and settlement instead of sharing one helper) — an ADR that only records the
  final shape without the rejected alternatives is less useful to a future reader
  re-deriving "why not."
- This ADR documents decisions already made in this specification (D1–D6) — it is not the
  venue for a new decision; write only after tasks 03/06/07 have actually landed, so the
  ADR reflects the implemented shape, not the planned one.

## Acceptance criteria

- The ADR exists under `docs/decisions/`, follows the repository's existing ADR shape, and
  cites this change (`deterministic-execution-follow-up-hardening`) as its source.
  `inspection: read the new ADR file`
- The ADR states the three-layer separation, the ownership-belongs-to-execution principle,
  the shared finish-operation-replayability classifier, and the three-outcome
  classification, each with the specific code location(s) that implement it.
  `inspection: read the new ADR file`
- The ADR records the rejected alternatives (persisted `resumable` status, explicit
  takeover acknowledgement, a duplicated per-call-site replayability check) and why they
  were rejected. `inspection: read the new ADR file`
- `node tools/docs.mjs validate` passes. `automated: node tools/docs.mjs validate`

## Verification

```bash
node tools/docs.mjs validate
```

## Out of scope

Superseding any existing ADR (none exists to supersede here).

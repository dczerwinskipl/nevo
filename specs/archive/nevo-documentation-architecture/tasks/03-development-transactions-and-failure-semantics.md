---
id: nevo-documentation-architecture.development-transactions-and-failure-semantics
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/architecture/persistence.md
    - docs/architecture/inbox-outbox.md
    - docs/architecture/messaging-pipeline.md
    - docs/templates/maintainer-doc-template.md
    - specs/active/nevo-documentation-architecture/areas/02-maintainer-documentation.md
  optional:
    - docs/guides/example-app-walkthrough.md
allowed_paths:
  - docs/architecture/persistence.md
  - docs/development/transaction-model.md
  - docs/development/failure-semantics.md
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/packages/**
  - docs/guides/**
  - docs/adr/**
  - docs/ai/**
  - docs/architecture/inbox-outbox.md
  - docs/architecture/messaging-pipeline.md
  - AGENTS.md
  - README.md
---

# Task: Development docs — transaction model and failure semantics

## Goal

Create `docs/development/transaction-model.md` (elevating `docs/architecture/persistence.md`'s
open-questions section) and `docs/development/failure-semantics.md` (new — consolidates
3 currently-scattered or unanswered maintainer questions), then remove
`docs/architecture/persistence.md`.

## Implementation constraints

- `transaction-model.md`: state explicitly, for each of the 5 questions currently listed
  in `persistence.md:43-61` (who commits, when `SaveChangesAsync` runs, inbox/handler
  transaction interaction, outbox-same-transaction-as-handler, multi-handler-same-transaction),
  whether it is now answered by this doc or remains genuinely open — do not invent an
  answer the code doesn't support. Include the rest of `persistence.md`'s content (EF
  Core integration, package structure table — fix the `NEvo.Orchestrating.EntityFramework`
  row if it repeats the D4 orchestration-persistence claim, cross-referencing task
  `development-inbox-outbox-eventsourcing-orchestration` which owns the authoritative
  fix) reorganized under the maintainer-doc template.
- `failure-semantics.md`: state event-fan-out partial-failure behavior (what happens to
  an already-succeeded handler when a later handler in the same dispatch fails — ground
  this in real source/test behavior if determinable, otherwise state it as an explicitly
  open question rather than guessing); state whether middleware registration order
  (`Correlation → Causation → Authorization → TransactionScope → Inbox → Logging →
  Telemetry`, per `messaging-pipeline.md:41-49`) is a framework-enforced contract or an
  artifact of default registration order that a consumer's own middleware could violate;
  restate outbox partition-assignment semantics as "not yet formally specified" (per
  `inbox-outbox.md:65-66`) rather than resolving it silently.
- Read `docs/architecture/inbox-outbox.md` and `messaging-pipeline.md` for context only
  (they are migrated by other tasks in this area) — do not edit them here.

## Acceptance criteria

- `docs/architecture/persistence.md` no longer exists.
- `docs/development/transaction-model.md` states a known/open verdict for each of the 5
  original questions.
- `docs/development/failure-semantics.md` covers event-fan-out partial-failure,
  middleware-ordering-as-contract, and outbox-partition-assignment.
- `node tools/docs.mjs validate` passes.

## Verification

```
node tools/docs.mjs validate
```

## Out of scope

Resolving any genuinely unresolved semantic question by inventing behavior not
supported by the code — an honestly-stated open question is an acceptable outcome, per
`references/decision-policy.md`. Editing `inbox-outbox.md` or `messaging-pipeline.md`
(other tasks own them).

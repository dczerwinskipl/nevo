---
id: event-sourcing-api-hardening.user-facing-event-sourcing-guide
status: draft
change: event-sourcing-api-hardening
depends_on:
  - harden-event-store-and-repository-contracts
  - es-command-executor-and-ambiguity-resolution
  - explicit-event-sourced-command-handler
  - primary-fallback-handler-roles
  - event-sourcing-registration-options
  - message-level-and-aggregate-authorization
  - map-query-endpoint-and-get-binding
  - documents-example-es-and-auth-demo
semantic_references:
  decisions: [D17, D18]
  dependency_contracts:
    - harden-event-store-and-repository-contracts
    - es-command-executor-and-ambiguity-resolution
    - explicit-event-sourced-command-handler
    - primary-fallback-handler-roles
    - event-sourcing-registration-options
    - message-level-and-aggregate-authorization
    - map-query-endpoint-and-get-binding
    - documents-example-es-and-auth-demo
context:
  required:
    - specs/active/event-sourcing-api-hardening/areas/user-facing-documentation.md
    - specs/active/event-sourcing-api-hardening/overview.md
    - docs/usage/README.md
    - docs/usage/commands.md
    - docs/usage/queries.md
    - docs/usage/authorization.md
    - docs/usage/choosing-packages.md
    - docs/usage/example-app-walkthrough.md
    - examples/ExampleApp/NEvo.ExampleApp.Documents.Api/
  optional:
    - docs/usage/quick-start.md
allowed_paths:
  - docs/usage/event-sourcing.md
  - docs/usage/README.md
  - docs/usage/queries.md
  - docs/usage/choosing-packages.md
  - docs/usage/example-app-walkthrough.md
forbidden_paths:
  - src/**
  - examples/**
  - docs/development/**
---

# Task: User-facing Event Sourcing guide (`docs/usage/event-sourcing.md`)

## Goal

Write `docs/usage/event-sourcing.md` — a single comprehensive consumer guide, following
this repository's established `docs/usage/*.md` flat-file convention (`type: guide`,
matching `commands.md`/`events.md`/`authorization.md` in shape, not a new subdirectory
structure), covering every topic listed below with concrete, testable acceptance
criteria — not "update docs where appropriate." A developer using NEvo must be able to
answer every question in "Required reader questions" below from this guide alone,
without reading framework source.

This is a first-class deliverable of this specification (external review, review
issue: "Documentation is a first-class deliverable, not an implementation note"), not
an afterthought bolted onto the internal architecture doc (task 12 owns that, kept
separate for a different audience).

## Dependencies

Every functional task in this change (02-07, 09-10) — this guide documents their
shipped, final shape. Sequenced last alongside task 12.

## Implementation constraints

- File: `docs/usage/event-sourcing.md`. Front matter: `id: guides.event-sourcing`,
  `type: guide`, `title: Event Sourcing`, `status: current`, plus a `summary:` — matching
  `docs/usage/commands.md`'s exact front-matter shape (`REQUIRED_FIELDS.guide` in
  `tools/docs/service.mjs`: `id`, `type`, `title`, `status`, `summary`).
- Add a row for it to `docs/usage/README.md`'s guide table (after "Authorization,"
  before "Troubleshooting," matching that table's rough dependency-order shape).
- Use the Documents example service (`examples/ExampleApp/NEvo.ExampleApp.Documents.Api/`,
  tasks 09-10) as the canonical walkthrough referenced throughout — link to specific
  files/commands in it rather than inventing separate illustrative code samples where
  the real example already demonstrates the point.
- State plainly, in the modeling section, that the current object-oriented immutable
  aggregate-state style is the **currently supported/default** modeling approach, not a
  permanent restriction of the Event Sourcing core (D17) — a short "future modeling
  styles" note (one paragraph) is sufficient; do not document mutable or static/
  functional models as implemented features, because they are not implemented.
- The projections/read-side section documents the current intermediate read path
  honestly (Query → QueryHandler → AggregateRepository → DTO) and states, in one short
  subsection or a clearly labeled note, that persisted projections are a future
  specification's scope — do not write speculative "how to implement projections"
  content as if it exists today.
- Update `docs/usage/queries.md` to reference `MapQueryEndpoint` (task 08's addition) as
  the recommended HTTP Query pattern, replacing/supplementing its current manually-wired
  `MapGet` example.
- Update `docs/usage/choosing-packages.md` and `docs/usage/example-app-walkthrough.md`
  if they describe the pre-refactor Document example location/shape (`ServiceA.Api`
  rather than the new `NEvo.ExampleApp.Documents.Api`) — small, targeted corrections,
  not a rewrite of either document.

## Required sections (each maps to a required-questions group below)

1. **Overview / mental model** — what NEvo Event Sourcing provides, what the framework
   owns vs. what the application owns, the command → decision → domain event →
   evolution → new state relationship, the OO-immutable style as current default (D17).
2. **Configuration** — `AddEventSourcing(options => {...})` (task 06), aggregate/handler
   discovery, the convention-fallback toggle and what disabling it does/doesn't affect,
   any registration requirements for repositories/stores, interaction with
   `AddMessages()`/`AddCommands()`.
3. **Modeling aggregates** — identity, concrete lifecycle states, immutable
   transitions, deciding from a command, evolving from an event, replay, same-command-
   on-multiple-states resolution (most-specific-wins, task 03), domain invariants vs.
   application/security concerns, when concrete state types are useful vs. excessive.
4. **Command handling choices** — all three levels, explicitly **when to use each**
   (a decision table or equivalent), what plumbing NEvo provides for each.
5. **Handler registration and fallback semantics** — Primary/Fallback (task 05),
   convention = Fallback, explicit/ordinary handlers = Primary, duplicate-Primary
   failure, why no numeric priority.
6. **Authorization and permissions** — operation permission on the message,
   handler-specific additional requirement (AND), aggregate/resource-aware
   authorization after rehydration (task 07), domain invariant stays in the decision
   method, explicit guidance against duplicating permission attributes across
   concrete state methods.
7. **Persistence and concurrency** — Event Store vs. repository responsibilities
   (task 02), replay, stream version, optimistic concurrency,
   `AggregateConcurrencyException` returned via `Either` (never thrown — D13/D19
   correction), domain event payload vs. persisted envelope metadata distinction,
   append/flush vs. final commit (D7 correction — cite the real `SaveChangesAsync`
   pattern, not a claim that no flush mechanism exists), synchronous event visibility
   guarantee, current in-memory-only status, explicit "real provider is a follow-up"
   statement.
8. **Query/read side** — the intermediate `Query → QueryHandler → AggregateRepository →
   DTO` path, `MapQueryEndpoint` usage and GET route/query-string binding (D18 — state
   plainly that `Id`/`CreatedAt` are never required GET parameters and why), explicit
   "not the final recommendation for complex read models" framing, and the future
   projections direction-only note.
9. **Example** — link to `NEvo.ExampleApp.Documents.Api` and its walkthrough note
   (task 10) as the canonical sample.

## Acceptance criteria

1. `docs/usage/event-sourcing.md` exists with valid `type: guide` front matter and
   passes `node tools/docs.mjs validate` (automated).
2. Every one of the 9 required sections above is present with concrete, non-hand-wavy
   content — not a stub or a "TODO" placeholder (inspection).
3. `docs/usage/README.md`'s guide table includes a row for the new guide (inspection).
4. `docs/usage/queries.md` references `MapQueryEndpoint` as the recommended HTTP Query
   pattern (inspection).
5. Neither this guide nor any updated file documents mutable aggregates, static/
   functional deciders, or persisted projections as implemented features — a search for
   speculative "how to" content describing unimplemented capabilities as available
   returns nothing (inspection).
6. **Required reader questions** — a reviewer can locate, in this guide alone, a direct
   answer to each of the following (inspection, checked one by one against the
   published guide):
   - How do I configure Event Sourcing?
   - How do I write the currently supported aggregate model?
   - How do commands produce events?
   - How does replay evolve state?
   - How do I model a state transition such as Editable → Approved?
   - How do I use the default convention handler?
   - When do I use an explicit Event Sourced handler?
   - When do I use a normal `ICommandHandler<T>`?
   - How does handler fallback work?
   - Where do permissions belong?
   - How do resource-aware permissions work?
   - How does optimistic concurrency work?
   - What does append/flush guarantee?
   - How do I expose/read an aggregate through Query today?
   - How do I map Query as HTTP GET?
   - What Event Sourcing capabilities are intentionally not implemented yet?
7. `node tools/docs.mjs validate` and `node tools/docs.mjs check` pass (automated).

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

This task is entirely documentation impact.

## Out of scope

- Internal/maintainer architecture documentation (task 12 — kept in
  `docs/development/event-sourcing.md`, a separate audience).
- Any speculative documentation of projections, mutable aggregates, or functional
  deciders as implemented capabilities.
- Rewriting `docs/usage/README.md`, `docs/usage/queries.md`, `docs/usage/
  choosing-packages.md`, or `docs/usage/example-app-walkthrough.md` beyond the targeted
  additions/corrections named above.

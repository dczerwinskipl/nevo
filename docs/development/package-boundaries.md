---
id: development.package-boundaries
type: development
title: Package boundaries
status: current
read_when:
  - adding a new project reference
  - evaluating whether a new package is needed
  - checking allowed dependency direction
summary: >
  Dependency graph, allowed reference directions, and modularity rules.
  Core rule: dependencies flow downward only. No upward references.
related:
  - development.architecture-overview
---

# Package boundaries

## Dependency graph

Derived from each `src/*/*.csproj`'s `ProjectReference` entries.

```
NEvo.Core                       (no project dependencies)
  │
  ├── NEvo.Messaging
  │     ├── NEvo.Messaging.Cqrs
  │     │     └── NEvo.Ddd.EventSourcing  [experimental]
  │     ├── NEvo.Messaging.Authorization  ──── NEvo.Authorization
  │     ├── NEvo.Messaging.Web            ──── NEvo.Web, NEvo.Messaging.Cqrs
  │     └── NEvo.Messaging.EntityFramework
  │
  ├── NEvo.Authorization
  │     ├── NEvo.Messaging.Authorization
  │     └── NEvo.Web.Authorization
  │
  ├── NEvo.Web
  │
  ├── NEvo.EntityFramework
  │
  └── NEvo.Orchestrating
        └── NEvo.Orchestrating.EntityFramework
```

`NEvo.Messaging.Web` also holds a direct `ProjectReference` to `NEvo.Core` — redundant
for reachability (already transitively reached via `NEvo.Messaging`), so not drawn as a
separate edge above.

## Rules

1. Dependencies flow **downward only** — no reverse references.
2. `NEvo.Core` must remain independent of all other NEvo packages.
3. `NEvo.Orchestrating` depends only on `NEvo.Core` — orchestration does not require messaging.
4. `NEvo.Messaging` extension packages (`*.Cqrs`, `*.Web`, `*.EntityFramework`) depend on
   `NEvo.Messaging` but not on each other — **except** `NEvo.Messaging.Web`, which also
   depends on `NEvo.Messaging.Cqrs` (for CQRS-based HTTP dispatch) and `NEvo.Web` (for
   its outbound HTTP client wrapper). This is the one documented exception to the "not on
   each other" clause.
5. A consuming application must be able to include only `NEvo.Messaging.Cqrs` without
   pulling in EF, web, or auth.

## Known unresolved decisions

`NEvo.Ddd.EventSourcing` depends on `NEvo.Messaging.Cqrs`. If event sourcing is later
made transport-agnostic, this dependency may need revisiting. Noted as an open question
for the event sourcing specification.

## Changing a dependency

Adding or removing a project reference is an **architectural decision** requiring owner
approval (see `AGENTS.md` — "Owner approval required"). Do not add cross-package references
without a specification.

## External dependency ownership

All external package versions are centrally managed in `Directory.Packages.props`.
Do not add `Version` attributes to `PackageReference` elements. New external packages
require owner approval before being added to `Directory.Packages.props`.

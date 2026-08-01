---
id: architecture.package-boundaries
type: architecture
title: Package boundaries
status: current
scope:
  - packages
  - dependencies
  - modularity
read_when:
  - adding a new project reference
  - evaluating whether a new package is needed
  - checking allowed dependency direction
summary: >
  Dependency graph, allowed reference directions, and modularity rules.
  Core rule: dependencies flow downward only. No upward references.
related:
  - architecture.overview
---

# Package boundaries

## Dependency graph

```
NEvo.Core                       (no project dependencies)
  │
  ├── NEvo.Messaging
  │     ├── NEvo.Messaging.Cqrs
  │     │     └── NEvo.Ddd.EventSourcing  [experimental]
  │     ├── NEvo.Messaging.Authorization  ──── NEvo.Authorization
  │     ├── NEvo.Messaging.Web            ──── NEvo.Web
  │     └── NEvo.Messaging.EntityFramework ─── NEvo.EntityFramework
  │
  ├── NEvo.Authorization
  │     ├── NEvo.Messaging.Authorization
  │     └── NEvo.Web.Authorization        ──── NEvo.Web
  │
  ├── NEvo.Web
  │
  └── NEvo.EntityFramework
        └── NEvo.Orchestrating.EntityFramework ─── NEvo.Orchestrating

NEvo.Orchestrating              (depends only on NEvo.Core)
```

## Rules

1. Dependencies flow **downward only** — no reverse references.
2. `NEvo.Core` must remain independent of all other NEvo packages.
3. `NEvo.Orchestrating` depends only on `NEvo.Core` — orchestration does not require messaging.
4. `NEvo.Messaging` extension packages (`*.Cqrs`, `*.Web`, `*.EntityFramework`) depend on
   `NEvo.Messaging` but not on each other.
5. A consuming application must be able to include only `NEvo.Messaging.Cqrs` without
   pulling in EF, web, or auth.

## Potential concern

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

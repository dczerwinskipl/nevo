---
id: spec.nevo-documentation-foundation
type: change
title: NEvo documentation foundation
status: draft
change: nevo-documentation-foundation
---

# NEvo documentation foundation

## Context

NEvo's existing documentation (`docs/architecture/`, `docs/development/`, `docs/adr/`,
`docs/ai/`, from the earlier `architecture-documentation` change) documents current
subsystem behavior and the AI-assisted SDLC process, but does not document NEvo as a
*usable framework*: no package has purpose/usage/configuration documentation, there is no
installation or quick-start guide, and there is no end-to-end walkthrough of the example
application. The owner requested a specification for a complete documentation system
covering project purpose, architecture, per-package documentation, use-case
documentation, developer documentation, and navigation — sourced only from repository
evidence, phased rather than attempted in one task, starting from representative edge
packages before the core.

## Current architecture

- 13 packages under `src/` (confirmed via `dotnet sln NEvo.sln list`); dependency
  direction rules and the module map already exist in
  `docs/architecture/package-boundaries.md` and `docs/architecture/overview.md`, but (see
  "Problem") the dependency diagram in the former does not match actual `.csproj`
  references in 3 places.
- No `src/**` package has a `README.md`. `tools/docs.mjs` validates exactly 5 document
  types (`architecture`, `development`, `adr`, `ai`, `change` — see
  `tools/docs.mjs:15-21`); there is no type for package-level or use-case/guide
  documentation.
- `examples/ExampleApp/` (5 projects: `Identity.Api`, `ServiceA.Api`, `ServiceB.Api`,
  Aspire `Orchestration.AppHost`, `Orchestration.ServiceDefaults`) is the only viable
  source for end-to-end use-case documentation. `examples/Gdpr` is not present in git
  HEAD and its one surviving code fragment targets an API
  (`EventSourcedAggregate<TId>`) that no longer exists in `NEvo.Ddd.EventSourcing`.
- 8 of 13 `src/` packages have no dedicated test project (see discovery evidence in
  conversation history / `nevo-ai-spec-researcher` report referenced by this change).

## Problem

- Package documentation is a full gap: zero packages document purpose, configuration,
  basic/advanced usage, or limitations today.
- Use-case documentation is a full gap: no installation guide, no quick start, no
  walkthrough of `examples/ExampleApp`.
- Navigation is a flat, generated, by-type listing (`docs/index.generated.md`) rather
  than a curated hub connecting architecture, packages, guides, and ADRs.
- Existing architecture docs contain factual errors that would otherwise be copied into
  new package docs: `docs/architecture/package-boundaries.md`'s dependency diagram
  disagrees with actual `ProjectReference` entries in 3 places, and `README.md`
  describes `NEvo.Web` as providing "HTTP middleware, request routing and integration
  with ASP.NET Core" when its actual contents are only an HTTP client wrapper
  (`NEvo.Web.Client`).

## Constraints

- No changes to production code, public APIs, package dependencies, or package structure
  (owner instruction) — this change touches only `docs/**`, `tools/docs.mjs`, `README.md`,
  and `specs/**`.
- `docs/architecture/` must describe current behavior only (`docs/ai/specification-workflow.md`
  § "Architecture documentation and ADRs").
- `tools/docs.mjs` front-matter validation must keep passing for all existing document
  types unchanged (additive-only extension, per D1).
- Package-boundary dependency-direction rules in `docs/architecture/package-boundaries.md`
  (see `docs/architecture/package-boundaries.md:49-56`) are the ground truth for
  documenting inter-package dependencies once corrected by task `architecture-corrections`.

## Affected modules

`docs/architecture/`, `docs/development/`, `docs/packages/` (new), `docs/guides/` (new),
`docs/templates/` (new, unindexed skeletons), `docs/ai/how-to-navigate.md`,
`tools/docs.mjs`, `README.md`. No `src/**`, `tests/**`, or `examples/**` files are
created or modified.

## Options and trade-offs

See `owner-decisions.md` (D1–D5) for the full option analysis on documentation taxonomy,
package-doc location, handling of discovered inconsistencies, example scope, and the
edge-package pilot selection.

## Owner decisions

Recorded in `owner-decisions.md`: D1 (doc taxonomy = extend `tools/docs.mjs` with
`package`/`guide` types), D2 (package docs live in `docs/packages/`, not per-package
READMEs), D3 (fix only the dependency-diagram and `NEvo.Web`-description errors now;
defer the maturity-table conflict), D4 (exclude `examples/Gdpr`), D5 (edge-package pilot
= `NEvo.Orchestrating` + `NEvo.Web.Authorization`).

## Proposed architecture

Nine areas of work, sequenced so that tooling and corrected facts exist before any
package doc is written, and the pilot validates the template before it scales to the
remaining 11 packages:

1. **Foundation** (`doc-taxonomy-and-tooling`, `package-classification-and-navigation-hub`)
   — extend `tools/docs.mjs`, create `docs/packages/`, `docs/guides/`, `docs/templates/`,
   write the package-classification map and the navigation hub page.
2. **Architecture corrections** (`architecture-corrections`) — fix the dependency-diagram
   and `NEvo.Web`-description errors (D3) before any package doc can inherit them.
3. **Edge-package pilot** (`package-doc-orchestrating`, `package-doc-web-authorization`)
   — validate the package-doc template against the two packages from D5.
4. **Core & messaging package docs** (`package-docs-core-and-messaging`,
   `package-docs-messaging-extensions`) — `NEvo.Core`, `NEvo.Messaging`, and its 4
   extension packages.
5. **Remaining package docs** (`package-docs-auth-and-persistence`,
   `package-docs-web-and-experimental`) — `NEvo.Authorization`, `NEvo.EntityFramework`,
   `NEvo.Web`, `NEvo.Ddd.EventSourcing`, `NEvo.Orchestrating.EntityFramework`.
6. **Use-case guides** (`quickstart-and-installation-guide`,
   `exampleapp-walkthrough-guide`) — installation, minimal setup, and an
   `examples/ExampleApp` walkthrough (common scenarios, edge cases, troubleshooting,
   expected runtime behavior).
7. **Developer & extension guides** (`developer-and-extension-guides`) — repository
   structure, how to add a transport/persistence mechanism/handler/event type/extension,
   coding conventions beyond commit conventions.
8. **Navigation and validation** (`navigation-and-validation`) — final cross-linking,
   `node tools/docs.mjs validate`/`check`, `node tools/specs.mjs validate`.

Note on sequencing versus the order originally suggested: architecture corrections (step
2 here) were moved earlier than "step 7" in the owner's original suggested order, because
downstream package docs would otherwise copy the same factual errors before they're
fixed. This is a sequencing refinement, not a scope change — recorded here for
transparency, not treated as a new owner decision.

## Areas

- `areas/01-foundation.md` — taxonomy, tooling, package classification, navigation hub
- `areas/02-architecture-corrections.md` — fixing discovered doc/code inconsistencies
- `areas/03-edge-package-pilot.md` — `NEvo.Orchestrating` + `NEvo.Web.Authorization`
- `areas/04-core-and-messaging-docs.md` — `NEvo.Core`, `NEvo.Messaging`, extensions
- `areas/05-remaining-package-docs.md` — the remaining 5 packages
- `areas/06-use-case-guides.md` — installation, quick start, example-app walkthrough
- `areas/07-developer-and-validation.md` — extension guides, final navigation validation

## Change-wide acceptance criteria

- `node tools/docs.mjs validate` passes for all new and modified documents.
- `node tools/docs.mjs check` reports indexes current after `generate`.
- `node tools/specs.mjs validate` reports no errors for this change.
- Every one of the 13 real `src/` packages (per `dotnet sln NEvo.sln list`) has a
  `docs/packages/<Name>.md` document covering purpose, responsibilities, dependencies,
  public concepts/APIs, configuration, basic usage, advanced usage, limitations, related
  packages, and relevant examples/tests — or explicitly states which sections don't apply
  and why.
- No factual claim in any new document is uncited to a file path in the repository.
- No `src/**`, `tests/**`, or `examples/**` file is created or modified by any task.

## Verification strategy

Per task: `node tools/docs.mjs validate` and `node tools/docs.mjs check` after content
changes, plus `dotnet build` unaffected (no source changes — a no-op check that nothing
outside `docs/**`/`tools/docs.mjs`/`README.md` was touched). Change-wide: a final
`/nevo-ai:spec-review` pass before any task is approved for implementation.

## Out of scope

- Any `src/**`, `tests/**`, or `examples/**` change.
- Fixing the `README.md` vs. `docs/architecture/overview.md` package-maturity table
  conflict (D3) — recorded as a follow-up candidate.
- Resurrecting or documenting `examples/Gdpr` (D4).
- Automated documentation staleness/cross-link enforcement in `tools/docs.mjs` (D1,
  option 3 — not chosen).
- CI/CD integration of documentation checks.

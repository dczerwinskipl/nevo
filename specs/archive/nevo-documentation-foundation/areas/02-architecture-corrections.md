# Area: Architecture corrections

## Responsibility

Fix the two categories of discovered doc/code inconsistency that would otherwise be
copied as wrong facts into new package documentation (D3), before any package doc is
written.

## Current state

- `docs/architecture/package-boundaries.md`'s dependency diagram (lines 26-45 as of
  discovery) shows `NEvo.Messaging.EntityFramework` and `NEvo.Orchestrating.EntityFramework`
  depending on `NEvo.EntityFramework` — neither package's `.csproj` actually references
  it (both reference only raw EF Core NuGet packages). The diagram also shows
  `NEvo.Web.Authorization` depending on `NEvo.Web` — its `.csproj` only references
  `NEvo.Authorization`. Separately, stated rule 4 ("messaging extension packages depend
  on `NEvo.Messaging` but not on each other") is contradicted by
  `NEvo.Messaging.Web`'s actual `ProjectReference` to `NEvo.Messaging.Cqrs`.
- `README.md`'s package table describes `NEvo.Web` as providing "HTTP middleware, request
  routing and integration with ASP.NET Core." Its actual contents (`src/NEvo.Web/`) are
  entirely under a `Client/` folder, namespace `NEvo.Web.Client` — an HTTP client wrapper,
  no middleware or routing code.

## Requirements

- Correct the dependency diagram in `docs/architecture/package-boundaries.md` to match
  actual `.csproj` `ProjectReference` entries.
- Either correct rule 4's wording to acknowledge the
  `NEvo.Messaging.Web` → `NEvo.Messaging.Cqrs` dependency, or note it as a documented
  exception with a one-line reason if evidence in code suggests why (do not invent a
  reason not supported by evidence — if none is found, state the rule/code mismatch
  plainly).
- Correct `README.md`'s one-line description of `NEvo.Web` to match its actual contents.

## Constraints

Per D3: the `README.md` vs. `docs/architecture/overview.md` package-maturity table
conflict is explicitly out of scope for this area — do not fix it here.

## Interfaces and boundaries

Every package-doc task (areas 03-05) reads the corrected
`docs/architecture/package-boundaries.md` as ground truth for describing a package's
dependencies.

## Area-specific acceptance criteria

- `docs/architecture/package-boundaries.md`'s dependency diagram matches the actual
  `ProjectReference` graph for all 13 packages (spot-checked against `.csproj` files).
- `README.md`'s `NEvo.Web` description matches its actual contents.
- `node tools/docs.mjs validate` passes.

## Dependencies

`01-foundation` (uses the same doc conventions established there, though this area does
not depend on the new `package`/`guide` types).

## Out of scope

The `README.md` vs. `overview.md` maturity-table conflict. Any `src/**` change to make
the code match the originally stated rule instead.

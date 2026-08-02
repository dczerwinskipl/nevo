# Owner decisions — nevo-documentation-foundation

## D1: Documentation taxonomy and tooling

- **Question:** How should package docs and use-case guides be typed, validated, and
  located, given `tools/docs.mjs` only recognizes 5 doc types (`architecture`,
  `development`, `adr`, `ai`, `change`) today?
- **Options considered:** (1) Minimal — reuse `architecture`/`development` types with no
  tooling change | (2) Balanced — extend `tools/docs.mjs` with new `package` and `guide`
  types plus `docs/packages/` and `docs/guides/` directories | (3) Target — same as (2)
  plus a `docs/reference/` scope and automated staleness/cross-link enforcement in
  `docs.mjs check`
- **Decision:** Option 2 (Balanced).
- **Rationale:** Owner accepted the recommendation as presented.
- **Consequences:** `tools/docs.mjs` gains `REQUIRED_FIELDS.package` and
  `REQUIRED_FIELDS.guide` entries (additive only — no existing type's required fields
  change). `docs/packages/` and `docs/guides/` become the canonical locations for the new
  content. No automated drift/staleness enforcement is added (that's Option 3, not
  chosen).
- **Date:** 2026-08-02
- **Affected artifacts:** `tools/docs.mjs`, `docs/packages/**`, `docs/guides/**`, task
  `doc-taxonomy-and-tooling`.

## D2: Package doc location

- **Question:** Do package docs live in a central `docs/packages/<Name>.md` tree or as a
  `README.md` inside each `src/<Name>/` package?
- **Options considered:** `docs/packages/<Name>.md` (central) | per-package
  `src/<Name>/README.md` (co-located, but implies `<PackageReadmeFile>` packaging config
  changes to surface on NuGet)
- **Decision:** `docs/packages/<Name>.md` (central).
- **Rationale:** Owner accepted the recommendation — avoids touching any `.csproj`, which
  is out of scope per the original request ("do not change... package structure").
- **Consequences:** No `src/**` files are created or modified by this change. All package
  docs are discoverable through `docs/packages/` and the navigation hub, not through
  NuGet-rendered READMEs.
- **Date:** 2026-08-02
- **Affected artifacts:** `docs/packages/**`, all per-package-doc tasks.

## D3: Handling of discovered doc/code inconsistencies

- **Question:** Discovery found the `package-boundaries.md` dependency diagram doesn't
  match actual `.csproj` references (3 concrete errors), `NEvo.Web`'s description doesn't
  match its actual contents, and `README.md`/`overview.md` maturity tables disagree for 5
  packages. Should this change fix these, flag them for a separate change, or fix only
  what would otherwise get copied as wrong facts into the new package docs?
- **Options considered:** (a) fix all inconsistencies now | (b) flag all, fix none, defer
  entirely to a follow-up change | (c) fix only the dependency-diagram errors and the
  `NEvo.Web` description (both would otherwise be copied as wrong facts into new package
  docs); leave the maturity-table conflict as a flagged, deferred item
- **Decision:** Option (c).
- **Rationale:** Owner accepted the recommendation.
- **Consequences:** Task `architecture-corrections` fixes
  `docs/architecture/package-boundaries.md`'s dependency diagram (remove the false
  `NEvo.EntityFramework` dependency edges for `NEvo.Messaging.EntityFramework` and
  `NEvo.Orchestrating.EntityFramework`; remove the false `NEvo.Web.Authorization` →
  `NEvo.Web` edge; document the real `NEvo.Messaging.Web` → `NEvo.Messaging.Cqrs`
  dependency and reconcile it with stated rule 4) and `README.md`'s one-line description
  of `NEvo.Web`. The `README.md` vs. `overview.md` package-maturity conflict is
  **explicitly out of scope** for this change and is recorded as a follow-up candidate,
  not silently left undocumented.
- **Date:** 2026-08-02
- **Affected artifacts:** `docs/architecture/package-boundaries.md`, `README.md`, task
  `architecture-corrections`.

## D4: Example scope

- **Question:** Should `examples/Gdpr` be treated as in-scope for use-case documentation,
  given it isn't in git HEAD and its one surviving fragment references an API that no
  longer exists?
- **Options considered:** include `examples/Gdpr` | exclude it, use `examples/ExampleApp`
  only
- **Decision:** Exclude `examples/Gdpr`.
- **Rationale:** Owner accepted the recommendation — the directory isn't tracked in git
  and is API-incompatible with current `NEvo.Ddd.EventSourcing`.
- **Consequences:** All use-case/end-to-end documentation (tasks
  `exampleapp-walkthrough-guide`, `quickstart-and-installation-guide`) is grounded solely
  in `examples/ExampleApp`'s 5 projects (`Identity.Api`, `ServiceA.Api`, `ServiceB.Api`,
  `Orchestration.AppHost`, `Orchestration.ServiceDefaults`).
- **Date:** 2026-08-02
- **Affected artifacts:** tasks `quickstart-and-installation-guide`,
  `exampleapp-walkthrough-guide`.

## D5: Representative edge packages for the phased pilot

- **Question:** Which two packages should be documented first to validate the package-doc
  template before scaling to the rest?
- **Options considered:** `NEvo.Orchestrating` + `NEvo.Web.Authorization` (recommended —
  opposite corners of the dependency graph: experimental/decoupled vs. minimal/stable) |
  owner-specified alternative packages
- **Decision:** `NEvo.Orchestrating` and `NEvo.Web.Authorization`.
- **Rationale:** Owner accepted the recommendation.
- **Consequences:** Tasks `package-doc-orchestrating` and `package-doc-web-authorization`
  are the first package-doc tasks in the sequence; the template used by every later
  package-doc task is validated against these two first.
- **Date:** 2026-08-02
- **Affected artifacts:** tasks `package-doc-orchestrating`,
  `package-doc-web-authorization`, and (as consumers of the validated template) every
  later package-doc task.

## D6: ADR necessity for D1

- **Question:** Does D1's `tools/docs.mjs` taxonomy/tooling extension require a new ADR
  under `references/artifact-policy.md`'s "When an ADR is needed"?
- **Options considered:** (a) write a new ADR for the taxonomy extension | (b) no
  separate ADR is required
- **Decision:** Option (b) — no separate ADR is required.
- **Rationale:** The decision is already durably recorded in `owner-decisions.md` (D1
  above) and concerns repository documentation taxonomy and tooling, not application or
  product architecture.
- **Consequences:** No `docs/adr/ADR-000x-*.md` is created by this change. D1 remains the
  sole durable record of this decision.
- **Date:** 2026-08-02
- **Affected artifacts:** `owner-decisions.md` (this entry), `overview.md` § "ADR
  impact" (none).

## D7: Conventions document target file (task `developer-and-extension-guides`)

- **Question:** Which file should hold the coding-conventions content described in task
  `developer-and-extension-guides`, given no existing `docs/development/*.md` file
  topically fits and the task originally left this as "implementer's choice"?
- **Options considered:** (1) `docs/development/conventions.md` | (2)
  `docs/development/coding-conventions.md` | (3) add a "Conventions" section to an
  existing file
- **Decision:** Option (2) — `docs/development/coding-conventions.md`.
- **Rationale:** Owner selected this over option 1 to avoid a naming clash with
  `commit-conventions.md` in directory listings.
- **Consequences:** Task `developer-and-extension-guides`'s `allowed_paths` grants write
  access to exactly `docs/guides/extending-nevo.md` and
  `docs/development/coding-conventions.md` — not the rest of `docs/development/**`. The
  task's blocking open question is resolved.
- **Date:** 2026-08-02
- **Affected artifacts:** `tasks/12-developer-and-extension-guides.md`.

## D8: `.gitignore` collision with `docs/packages/`

- **Question:** `docs/packages/` (the D2 central location) is silently caught by the
  legacy Visual Studio NuGet-restore ignore rule `**/[Pp]ackages/*` in `.gitignore:190`
  — every file written there by tasks `package-doc-orchestrating`,
  `package-doc-web-authorization`, `package-docs-core-and-messaging`,
  `package-docs-messaging-extensions`, `package-docs-auth-and-persistence`, and
  `package-docs-web-and-experimental` would silently never be tracked by git. `.gitignore`
  is outside every task's `allowed_paths`. How should this be fixed?
- **Options considered:** (1) narrow negation `!docs/packages/**` right after the NuGet
  block | (2) broader negation `!docs/**` in the same spot, covering the whole docs tree
  against this and any future legacy build-artifact pattern collision (repo uses
  `Directory.Packages.props` central package management — confirmed via
  `git status --porcelain --ignored=matching` that no real NuGet `packages/` restore
  folder exists anywhere in the repo today, so the rule is legacy/dead weight outside
  `docs/`) | (3) narrow the NuGet rule itself to `src/**/[Pp]ackages/*`
- **Decision:** Option (2) — `!docs/**` added at `.gitignore` (after the existing
  `!**/[Pp]ackages/build/` line).
- **Rationale:** Owner asked for the most universal fix. Scoping the negation to the
  whole `docs/` tree (not just `docs/packages/`) prevents the same silent-ignore failure
  for any future documentation directory, without touching the NuGet rule's behavior for
  actual code under `src/`.
- **Consequences:** Task `doc-taxonomy-and-tooling`'s `allowed_paths` is amended to
  include `.gitignore` (repo-wide file, outside the change's normal `docs/**`/
  `specs/active/**` scope) so this fix is in-scope rather than a silent violation.
- **Date:** 2026-08-02
- **Affected artifacts:** `.gitignore`, task `doc-taxonomy-and-tooling`.

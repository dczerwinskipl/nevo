---
id: spec.nevo-documentation-architecture
type: change
title: NEvo documentation architecture
status: draft
change: nevo-documentation-architecture
---

# NEvo documentation architecture

## Context

The first documentation pass (`nevo-documentation-foundation`, archived) produced a
technically grounded but repository-inventory-shaped documentation set: package docs
answer "what classes/registrations exist," architecture docs answer "what is currently
implemented," and reader-facing prose is frequently interleaved with documentation-process
narration ("confirmed against `X.csproj`", "verified directly against `Y.cs`"). This is a
follow-up change, requested by the owner, to reorganize and refine that material into
documentation that serves three audiences — consumers, maintainers, and AI agents —
without maintaining three competing copies of the same knowledge. This change does not
redesign NEvo itself, does not fix implementation defects, and does not modify or expand
the scope of the archived first-pass change.

## Current architecture

Confirmed by direct inspection of `docs/` on disk (via the `nevo-ai-spec-researcher`
subagent, cross-checked against the archived spec where relevant — not trusted from the
archived spec's own claims):

- `docs/` currently holds: `README.md` (curated hub), `guides/` (4 files: quick-start,
  installation, extending-nevo, example-app-walkthrough), `packages/` (14 files: 13 real
  packages + `classification.md`), `architecture/` (9 files), `development/` (6 files:
  local-setup, coding-conventions, testing, git-workflow, commit-conventions,
  pull-requests), `ai/` (4 files), `adr/` (5 files, all `status: accepted`), `templates/`
  (2 unindexed skeletons: `package-doc-template.md`, `guide-doc-template.md`).
- `tools/docs/service.mjs`'s `REQUIRED_FIELDS` (`tools/docs/service.mjs:16-23`) validates
  exactly 7 document types today: `architecture`, `development`, `adr`, `ai`, `change`,
  `package`, `guide`. There is no `project` type.
- Every one of the 6 known-issue examples from the original request (auth→500,
  permission names ignored, fake event store, missing orchestration persistence,
  incomplete outbox, GET/POST inconsistency) is already documented, but scattered inside
  individual package docs' "Limitations" sections — there is no central known-issues
  document.
- Process-language pollution ("confirmed via `dotnet sln NEvo.sln list`", "verified
  directly against `X.csproj`", quoted `grep -rn` commands) is pervasive across ~10 of 14
  package docs and 3 guides — not isolated to a few files. One file
  (`docs/packages/NEvo.EntityFramework.md:106-107`) leaks an internal spec task ID
  (`architecture-corrections`) into reader-facing prose.
- Duplicated concepts confirmed across multiple files: the `Either<Exception, T>`
  convention (4 files), the downward-only dependency rule (4 files), the
  `NEvo.Web.Authorization` "doesn't depend on `NEvo.Web`" fact (4 occurrences across 2
  files), orchestration's "decoupled from messaging" fact (3 files).
- `docs/ai/how-to-navigate.md` is scoped entirely to the spec/task workflow (finding the
  next approved task, loading a context packet) — it does not route an agent to framework
  documentation by topic (e.g. "which docs to read for a messaging change"). No document
  in the repository currently answers that question.
- The archived spec's own D3/D9/D10/D11 already fixed several architecture-doc-vs-code
  drift instances. This change's own discovery found 5 more that D3–D11 did not cover
  (see "New inconsistencies found by this change" below).

## Problem

- **Mixed purposes per file.** Most package docs interleave reference facts
  (Purpose/Dependencies/Public surface) with tutorial-style "Basic usage"/"Advanced
  usage" walkthroughs that duplicate content already covered (or that should be covered)
  in `docs/guides/`.
- **No task-oriented guide for several stated reader goals.** Configuring authorization
  end-to-end, diagnosing common failures generally (not just inside one example app),
  inbox/outbox end-to-end usage, EF persistence+migration setup, orchestration usage, and
  "which packages do I need" have no corresponding guide today.
- **No consolidated maintainer contract for several invariants.** Transaction ownership
  is explicitly stated as unresolved in `docs/architecture/persistence.md` but nowhere
  resolved; event-fan-out failure/partial-failure semantics, middleware-ordering
  guarantees, and the `IMessageHandlerFactory` extension contract are each described
  informally or not at all.
- **No central known-issues document.** Confirmed defects are real and already written
  down, but only inside package "Limitations" sections, not surfaced as a first-class,
  scannable known-issues list.
- **Reader-facing process narration.** Reader-facing docs should state facts directly;
  today they frequently narrate how the fact was established.
- **No AI task-routing layer for framework knowledge**, as distinct from the existing
  spec/task-workflow navigation doc.

## New inconsistencies found by this change's own discovery (beyond the first pass's D3/D9/D10/D11)

1. `docs/architecture/overview.md:41` describes `NEvo.Messaging.Cqrs` as covering "CQRS
   commands and queries," but `docs/packages/NEvo.Messaging.Cqrs.md:98-104` states
   query-side support is not implemented at all.
2. `docs/architecture/orchestration.md:98-101` states `IOrchestratorStateRepository` is
   implemented "using Entity Framework Core / SQL Server," but
   `docs/packages/NEvo.Orchestrating.EntityFramework.md:92-99` states no implementation
   exists anywhere in the repository.
3. `docs/architecture/overview.md:49-51` uses "In progress" as a maturity label; every
   corresponding package doc's front matter uses `status: experimental` — different
   vocabulary for the same signal, never reconciled.
4. `docs/architecture/overview.md:46` still describes `NEvo.Web` as providing "ASP.NET
   Core integration," which `docs/packages/NEvo.Web.md:11,20-21` itself explicitly
   corrects ("not ASP.NET Core middleware or routing, despite the name").
5. `docs/architecture/processing-model.md:48` refers to an `ICommand`/`ICommand<TResult>`
   interface; the real type, per `docs/packages/NEvo.Messaging.Cqrs.md:42-44`, is a
   `Command` record — no `ICommand` interface exists.

Per D4 (`owner-decisions.md`), all 5 are corrected in this change, at the task that owns
the consolidated maintainer doc where the wrong fact currently lives.

## Constraints

- No `src/**`, `tests/**`, or `examples/**` change (same boundary as the first pass).
- `docs/development/*` (post-merge, absorbing `docs/architecture/*`) must describe
  current behavior only — no speculative future behavior presented as current.
- `tools/docs/service.mjs`'s `REQUIRED_FIELDS` extension (the new `project` type) is
  additive only — no existing type's required fields change.
- `.gitignore`'s `!docs/**` negation (added by the first pass's D8) already covers every
  new nested directory this change introduces (confirmed: `docs/reference/packages/**`
  remains tracked; no `.gitignore` change is needed).
- Per D1/D5, the `docs/architecture/`→`development/` merge and `docs/adr/`→`decisions/`
  rename require path-string updates (not content rewrites) in the multi-tool AI-adapter
  layer outside `docs/**` — see the exact file list in D5.
- Each significant concept (the `Either<T>` convention, dependency-direction rule,
  transaction semantics, etc.) has exactly one authoritative document after this change;
  every other reference links to it instead of restating it.

## Affected modules

`docs/**` (near-complete reorganization), `tools/docs/service.mjs` (new `project` type),
`AGENTS.md`, root `README.md`, `.cursor/rules/nevo.mdc`,
`.github/copilot-instructions.md`, `.github/pull_request_template.md`, and the specific
`.claude/skills/**`/`.claude/agents/**` files named in D5 (path-string updates only). No
`src/**`, `tests/**`, or `examples/**` file is created or modified by any task.

## Owner decisions

Recorded in `owner-decisions.md`: D1 (target IA = full target shape, without the
brief's `docs/reference/configuration/`/`public-api/` subdirectories — no content exists
to populate them), D2 (new `project` doc type, known-issues only — no maturity/roadmap
this round), D3 (package-reference trim = all 14 packages in one pass, not phased), D4
(the 5 new inconsistencies above are fixed in this change, not filed as known issues),
D5 (the rename's adapter-layer collateral edits are in scope).

## Proposed architecture

### Target tree

```text
docs/
  README.md                       (thin index — points into usage/README.md, development/README.md, ai/)
  index.generated.md / .json      (generated, mechanism unchanged)
  usage/                          (was guides/)
    README.md                     (consumer entry point — NEW)
    quick-start.md                (migrated, process-language stripped)
    choosing-packages.md          (NEW — "which packages do I need for X")
    commands.md                   (NEW — split from quick-start.md/extending-nevo.md)
    events.md                     (NEW — split from quick-start.md/extending-nevo.md)
    cross-service-messaging.md    (NEW — generalized from example-app-walkthrough Scenario 4)
    inbox-outbox.md               (NEW — task-oriented: enabling idempotency + transactional publish)
    authorization.md              (NEW — end-to-end authorization wiring, the audit's top guide gap)
    troubleshooting.md            (NEW — generalized from example-app-walkthrough's embedded section)
    example-app-walkthrough.md    (migrated, unchanged content minus process language)
    (installation.md's content folds into quick-start.md's prerequisites — see task 9)
  development/                    (was development/ + architecture/, merged)
    README.md                     (maintainer entry point — NEW)
    architecture-overview.md      (was architecture/overview.md)
    package-boundaries.md         (was architecture/package-boundaries.md)
    messaging-pipeline.md         (was architecture/messaging-pipeline.md)
    processing-model.md           (was architecture/processing-model.md)
    message-context.md            (was architecture/message-context.md)
    transaction-model.md          (NEW — elevates persistence.md's open-questions section)
    failure-semantics.md          (NEW — event fan-out, middleware ordering, outbox partitioning)
    extension-points.md           (NEW — IMessageHandlerFactory contract, forbidden approaches)
    transport-development.md      (NEW — split from guides/extending-nevo.md, maintainer-facing half)
    persistence-development.md    (NEW — split from extending-nevo.md + architecture/persistence.md)
    inbox-outbox.md               (was architecture/inbox-outbox.md, maintainer-level)
    event-sourcing.md             (was architecture/event-sourcing.md)
    orchestration.md              (was architecture/orchestration.md)
    testing-strategy.md           (was development/testing.md, augmented with per-subsystem test pointers)
    contributing.md               (NEW — thin entry point linking the 5 files below)
    coding-conventions.md         (unchanged)
    commit-conventions.md         (unchanged)
    git-workflow.md               (unchanged)
    local-setup.md                (unchanged)
    pull-requests.md              (unchanged)
  reference/
    packages/                     (was packages/, trimmed to reference-only content)
      classification.md
      NEvo.*.md                   (14 files)
  project/
    known-issues.md               (NEW — central known-issues document)
  decisions/                      (was adr/, files unchanged)
    ADR-0001..0005-*.md
  ai/
    how-to-navigate.md            (unchanged — spec/task-workflow navigation)
    workflow-overview.md          (unchanged)
    task-execution-policy.md      (unchanged)
    specification-workflow.md     (unchanged)
    task-routing.md               (NEW — framework-knowledge routing)
    change-impact-map.md          (NEW)
  templates/
    package-doc-template.md       (revised — reference-only, no Basic/Advanced usage)
    guide-doc-template.md         (lightly revised — adds a constraints/failure-modes section)
    maintainer-doc-template.md    (NEW)
```

`docs/reference/configuration/` and `docs/reference/public-api/` from the original
brief's illustrative tree are intentionally not created (see D1) — configuration/DI
wiring and public-surface facts stay inside each package reference page, which the
brief's own "Package reference" rules already require them to cover.

### Sequencing

1. **Foundation** (task 1) — `project` doc type, revised templates. Everything else
   depends on this.
2. **Maintainer documentation consolidation** (tasks 2–6) — merge `architecture/` into
   `development/`, fill the missing-invariant gaps, fix the 5 new inconsistencies (D4).
   Runs in parallel with task 7.
3. **Known-issues consolidation** (task 7) — extract the central known-issues document
   from current package "Limitations" sections, so task 8 can strip that content out of
   the package pages rather than duplicating it.
4. **Package reference migration and trim** (task 8) — depends on tasks 2–6 and 7, so
   trimmed package pages can link to the now-consolidated authoritative maintainer docs
   and the known-issues doc instead of restating either.
5. **Consumer usage guides** (tasks 9–13) — depend on task 8 (need final package
   reference locations/content) and, where relevant, the maintainer docs they cross-link.
6. **Navigation, AI routing, and validation** (tasks 14–16) — entry points and hub last
   (need every other file's final location), then AI task-routing, then the full
   cross-link/adapter-path validation pass (D5).

## Areas

- `areas/01-foundation.md` — doc taxonomy, templates.
- `areas/02-maintainer-documentation.md` — `docs/development/` consolidation (was
  `architecture/` + `development/`), invariant gaps, the 5 inconsistency fixes.
- `areas/03-known-issues.md` — central known-issues document.
- `areas/04-package-reference.md` — `docs/reference/packages/` migration and trim.
- `areas/05-usage-guides.md` — `docs/usage/` (was `guides/`) — migration plus 6 new
  task-oriented guides.
- `areas/06-navigation-and-ai-routing.md` — entry points, hub, AI task-routing,
  repo-wide cross-link and adapter-path validation.

## Change-wide acceptance criteria

- `node tools/docs.mjs validate` passes for all new and modified documents.
- `node tools/docs.mjs check` reports indexes current after `generate`.
- `node tools/specs.mjs validate` reports no errors for this change.
- No document under `docs/**` contains documentation-process narration ("confirmed
  against", "verified directly against", quoted `grep`/`find` commands, internal spec
  task IDs) after this change — reader-facing prose states facts directly.
- Every one of the 14 real `src/` packages has a `docs/reference/packages/<Name>.md`
  containing only reference content (no "Basic usage"/"Advanced usage" tutorial
  sections) and cross-linking to the guide(s) that cover its usage.
- `docs/project/known-issues.md` contains every known-issue item identified by this
  change's discovery audit, each with: affected feature, current behavior, practical
  consequence, intended behavior (if known), severity/usage recommendation, source
  location, and — where applicable — the related archived task/spec.
- Each of the 5 new inconsistencies listed above is resolved (one authoritative
  statement of the fact remains).
- No internal link (within `docs/**`) or cross-reference in the adapter-layer files
  named in D5 points to a pre-migration path.
- No `src/**`, `tests/**`, or `examples/**` file is created or modified by any task.

## Verification strategy

Per task: `node tools/docs.mjs validate` and `node tools/docs.mjs check` after content
changes. Change-wide: `node tools/specs.mjs validate`, plus the 8 concrete reader-task
validations from the original request (package/command dispatch discoverable without
reading source; publish/handle an event understandable; a maintainer can find where to
add a transport; a maintainer can find the invariants/tests for a dispatch change; an AI
agent can find the minimum relevant docs for a messaging change; production-ready vs.
experimental vs. placeholder is distinguishable; every significant concept has one
source of truth; package pages no longer duplicate full guides/architecture) — run as an
explicit checklist in task `final-cross-link-and-validation`. A final `/nevo-ai:spec-review`
pass before any task is approved for implementation.

## Out of scope

- Any `src/**`, `tests/**`, or `examples/**` change.
- Fixing implementation defects found in `docs/project/known-issues.md` — those are
  candidates for a separate follow-up spec, not this change.
- `docs/project/maturity.md` and `docs/project/roadmap.md` (D2).
- `docs/reference/configuration/` and `docs/reference/public-api/` (D1).
- Rewriting `docs/ai/how-to-navigate.md`, `workflow-overview.md`,
  `task-execution-policy.md`, `specification-workflow.md`, or any ADR's content — only
  the `docs/adr/` → `docs/decisions/` path rename touches this subsystem (D5), and only
  as a path-string substitution, not a content change.
- CI/CD integration of documentation checks.

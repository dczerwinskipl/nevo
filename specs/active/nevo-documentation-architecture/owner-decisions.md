# Owner decisions — nevo-documentation-architecture

## D1: Target information architecture shape

- **Question:** Should the new spec adopt the brief's illustrative directory tree
  exactly (`docs/usage/`, a merged `docs/development/` folding in `docs/architecture/*`,
  `docs/reference/packages/`, `docs/project/`, `docs/decisions/`), a minimal-rename
  variant that keeps every current directory name and expresses the three-audience
  split only through `docs/README.md` and front matter, or a balanced middle ground
  (rename `docs/guides/` only, keep `docs/architecture/`/`docs/development/` split)?
- **Options considered:** (1) Balanced rename — rename `guides/` only, keep
  `architecture/`+`development/` split, add `project/`, leave `ai/`/`adr/` untouched
  except two new AI-routing files | (2) Minimal rename (recommended) — keep every
  current directory name, add only `docs/project/known-issues.md`, express audience
  split editorially | (3) Full target shape — adopt the brief's illustrative tree
  exactly, merging `docs/architecture/*` into `docs/development/*` and renaming
  `docs/packages/` → `docs/reference/packages/`, `docs/adr/` → `docs/decisions/`.
- **Decision:** Option 3 — Full target shape.
- **Rationale:** Owner chose the fullest fidelity to the brief's illustrative structure
  over the lower-migration-cost alternatives; no additional rationale given beyond the
  selection.
- **Consequences:** `docs/architecture/*` (9 files) and `docs/development/*` (6
  existing files, unchanged) are consolidated under one `docs/development/` tree,
  content-merged (not just moved) per the mapping in `overview.md` § "Proposed
  architecture". `docs/guides/` → `docs/usage/`. `docs/packages/` →
  `docs/reference/packages/`. `docs/adr/` → `docs/decisions/`. `docs/reference/configuration/`
  and `docs/reference/public-api/` from the brief's illustrative tree are **not**
  created — no concrete content exists to populate them today (configuration/DI wiring
  and public-surface facts stay inside each package reference page, per the "Package
  reference" rules in the brief). This is a deliberate, transparent deviation from the
  illustrative tree, not a silent scope cut — recorded here per `references/artifact-policy.md`
  § "How to avoid empty boilerplate".
- **Date:** 2026-08-03
- **Affected artifacts:** all tasks in areas `maintainer-documentation`,
  `package-reference`, `usage-guides`, `navigation-and-ai-routing`.

## D2: Known-issues document placement and `project` doc type scope

- **Question:** Where should the new central known-issues document live, and does
  feature-maturity or roadmap content ship in this change?
- **Options considered:** (1) New `project` doc type, known-issues only (recommended)
  | (2) New `project` doc type, known-issues + a standalone `maturity.md` | (3) Reuse
  the existing `development` doc type, no tooling change.
- **Decision:** Option 1 — new `project` doc type, `docs/project/known-issues.md` only.
- **Rationale:** Owner accepted the recommendation as presented.
- **Consequences:** `tools/docs/service.mjs`'s `REQUIRED_FIELDS` gains a `project` entry,
  additive only (mirrors the first pass's D1 pattern for `package`/`guide`). No
  `maturity.md` or `roadmap.md` is created this round — feature-maturity signals stay
  inside the consumer/maintainer entry points' own tables (per-package `status` front
  matter already carries this). `docs/project/roadmap.md` is out of scope: it isn't in
  the brief's required-deliverables list and no roadmap content exists anywhere in the
  repository to migrate.
- **Date:** 2026-08-03
- **Affected artifacts:** `tools/docs/service.mjs`, `docs/project/known-issues.md`,
  task `known-issues-consolidation`.

## D3: Package-reference migration rollout

- **Question:** Should trimming the 14 package docs down to pure reference material
  (per the brief's "Package reference" rules) be phased through a representative pilot
  first, or done in one pass across all 14?
- **Options considered:** (1) Phased pilot then scale (recommended) — trim 2
  representative packages first, validate the tightened template, then scale to the
  remaining 12 | (2) All at once — trim all 14 in a single task.
- **Decision:** Option 2 — All at once.
- **Rationale:** Owner selected the single-pass option over the recommended phased
  approach; no additional rationale given beyond the selection.
- **Consequences:** Task `package-reference-migration-and-trim` covers all 14 package
  docs plus `classification.md` in one task rather than a pilot-then-scale sequence.
  There is no intermediate checkpoint to catch a template problem before it has been
  applied 14 times — the task's own acceptance criteria and the subsequent
  `spec-review` pass are the only structural safeguards against that risk.
- **Date:** 2026-08-03
- **Affected artifacts:** task `package-reference-migration-and-trim`.

## D4: Handling of documentation inconsistencies discovered by this change's own audit

- **Question:** Should the 5 new documentation inconsistencies this change's discovery
  audit found (CQRS query-side claim in `overview.md`, orchestration-persistence claim
  in `orchestration.md`, a maturity-vocabulary mismatch, a stale "ASP.NET Core
  integration" line describing `NEvo.Web`, and an `ICommand` vs. `Command`-record
  naming mismatch in `processing-model.md`) be corrected as part of this change, or
  filed as known issues / a follow-up?
- **Options considered:** (1) Fix in this change (recommended) — same standing policy
  the first pass used (its D11): descriptive-only corrections, no behavior/architecture
  change, surfaced naturally while consolidating the same content into fewer
  authoritative maintainer docs | (2) File as known issues / follow-up — leave the 5
  inconsistencies as found, record them in the new known-issues doc instead.
- **Decision:** Option 1 — Fix in this change.
- **Rationale:** Owner accepted the recommendation as presented.
- **Consequences:** Each of the 5 corrections is applied in the task that owns the
  consolidated maintainer doc where the wrong fact currently lives (see `overview.md`
  § "Proposed architecture" and the relevant task files' "Implementation constraints").
  None of the 5 are entries in `docs/project/known-issues.md` — they are documentation
  inaccuracies, not implementation defects, and are corrected at the source rather than
  tracked as an open issue.
- **Date:** 2026-08-03
- **Affected artifacts:** tasks `development-core-pipeline-docs` (CQRS query-side,
  `ICommand` naming, stale `NEvo.Web` description, maturity-vocabulary mismatch),
  `development-inbox-outbox-eventsourcing-orchestration` (orchestration-persistence
  claim).

## D5: Rename blast radius beyond `docs/**`

- **Question:** `docs/architecture/` → `development/` and `docs/adr/` → `decisions/`
  (per D1) are also referenced outside `docs/**` — in `AGENTS.md`, root `README.md`,
  `.cursor/rules/nevo.mdc`, `.github/copilot-instructions.md`,
  `.github/pull_request_template.md`, and ~6 files under `.claude/skills/`/
  `.claude/agents/` (the multi-tool AI-adapter layer, not framework documentation).
  Proceed with the full rename including mechanical path-string updates in those files,
  or keep `docs/architecture/` and `docs/adr/` directory names stable to avoid touching
  the adapter layer?
- **Options considered:** (1) Full rename, update adapters too (recommended) — keep D1
  as decided; path-string references in the listed adapter files are updated to match,
  with no other content in those files changed | (2) Keep `docs/architecture/` and
  `docs/adr/` stable — do the rest of the full-target-shape migration
  (`docs/guides/`→`usage/`, `docs/packages/`→`reference/packages/`, new `docs/project/`)
  without renaming these two, avoiding any edit outside `docs/**`.
- **Decision:** Option 1 — Full rename, update adapters too.
- **Rationale:** Owner accepted the recommendation as presented.
- **Consequences:** Task `final-cross-link-and-validation`'s `allowed_paths` is widened
  beyond `docs/**` to include exactly: `AGENTS.md`, `README.md`,
  `.cursor/rules/nevo.mdc`, `.github/copilot-instructions.md`,
  `.github/pull_request_template.md`, and the specific `.claude/skills/**`/
  `.claude/agents/**` files identified during discovery
  (`.claude/skills/nevo-ai-spec-workflow/references/solution-option-analysis.md`,
  `references/triage-policy.md`, `references/discovery-policy.md`,
  `references/review-policy.md`, `references/artifact-policy.md`,
  `.claude/skills/nevo-ai-github/SKILL.md`, `.claude/agents/nevo-ai-spec-researcher.md`).
  Every edit in these files is a `docs/adr/` → `docs/decisions/` or
  `docs/architecture/` → `docs/development/` path-string substitution only — no other
  prose or policy content in these files changes. `tools/tests/index-generation.test.mjs`
  was checked and does **not** need updating: its `docs/adr`/`docs/architecture` strings
  are synthetic in-memory fixture labels, not real paths read from disk.
- **Date:** 2026-08-03
- **Affected artifacts:** task `final-cross-link-and-validation`.

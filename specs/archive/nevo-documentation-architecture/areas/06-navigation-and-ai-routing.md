# Area: Navigation and AI routing

## Responsibility

Build the consumer and maintainer entry points, the thin AI task-routing layer, and
perform the repo-wide cross-link and adapter-path validation this change's rename
decisions (D1, D5) require.

## Current state

`docs/README.md` is a single curated hub covering architecture, packages, guides,
development, ADRs, and the AI workflow in one flat page — not split by audience.
`docs/ai/how-to-navigate.md` routes agents through the spec/task workflow only, not
through framework documentation by topic. `docs/adr/` and `docs/architecture/` paths are
referenced in `AGENTS.md`, root `README.md`, `.cursor/rules/nevo.mdc`,
`.github/copilot-instructions.md`, `.github/pull_request_template.md`, and 6 files under
`.claude/skills/`/`.claude/agents/` — all outside `docs/**` (confirmed by repository-wide
grep during discovery; D5).

## Requirements

- `docs/usage/README.md` (NEW) — consumer documentation entry point, per the brief's
  deliverables list.
- `docs/development/README.md` (NEW) — maintainer documentation entry point.
- `docs/README.md` — rewritten as a thin top-level index pointing into
  `usage/README.md`, `development/README.md`, `docs/reference/packages/classification.md`,
  `docs/project/known-issues.md`, `docs/decisions/`, and `docs/ai/`, rather than
  reproducing their content (current `docs/README.md`'s per-doc description tables move
  into the two new entry points, split by audience).
- `docs/ai/task-routing.md` (NEW) — per the brief's example format: for a given kind of
  task, which documents to read, which invariants to preserve, which tests to run.
- `docs/ai/change-impact-map.md` (NEW) — which source directories map to which
  documentation, so an agent can find the minimum relevant set for a given change.
- Repo-wide path-string update: every reference to `docs/adr/` → `docs/decisions/` and
  `docs/architecture/` → `docs/development/` (or the specific new filename it moved to)
  across `docs/**` and the exact adapter-layer file list in D5 — content in adapter
  files otherwise unchanged.
- Run the 8 concrete reader-task validations listed in `overview.md` §
  "Verification strategy" as an explicit checklist and record the result.

## Constraints

Per D5, every adapter-layer edit is a path-string substitution only — no policy or
process content in those files changes as part of this area.

## Interfaces and boundaries

Depends on every other area for final file locations before it can produce correct
links. This is intentionally the last area.

## Area-specific acceptance criteria

- `node tools/docs.mjs validate` and `check` pass repo-wide.
- No internal `docs/**` link points to a pre-migration path.
- No adapter-layer file listed in D5 contains a stale `docs/adr/` or
  `docs/architecture/` reference.
- The 8 reader-task validations are each recorded pass/fail with evidence.

## Dependencies

Depends on all other areas.

## Out of scope

Any content change to `docs/ai/how-to-navigate.md`, `workflow-overview.md`,
`task-execution-policy.md`, `specification-workflow.md`, or any ADR body — path-string
substitution only, per D5.

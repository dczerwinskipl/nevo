---
id: spec.nevo-ai-operational-workflow
type: change
title: NEvo AI operational workflow (Claude Code layer)
status: in-implementation
change: nevo-ai-operational-workflow
---

# NEvo AI operational workflow (Claude Code layer)

## Goal

Add a Claude Code operational layer on top of the AI-assisted SDLC process bootstrapped
in `architecture-documentation`: namespaced `/nevo-ai:*` commands, a shared workflow
skill, and a read-only research subagent — without replacing `AGENTS.md`,
`tools/specs.mjs`, or `tools/docs.mjs`. Consolidate the vendor-neutral workflow
description into `docs/ai/specification-workflow.md` so Claude, Cursor, and Copilot
adapters can point to one source instead of duplicating it.

A second task extends the same operational layer with technical (non-domain) decision
support — signal-based change triage and mandatory solution-option analysis for
architecture-gated decisions — adapted from reviewing an external, DDD-oriented example
repository and keeping only what applies to a technical framework with no business
domain to model. See [ADR-0003](../../../docs/adr/ADR-0003-technical-decision-triage-and-option-analysis.md).

A third task closes four compounding gaps the owner hit running this workflow for
real against a genuine spec (`nevo-documentation-foundation`): an unpersisted,
unclassified review report with no next step; a verdict composed as prose that once
contradicted its own findings (an unresolved blocking decision alongside "ready for
owner approval"); a re-review that wrongly inferred "nothing changed" from an
untracked directory's `git status` and repeated already-fixed findings; and a
`ready-for-approval` verdict that ended in an instruction to hand-edit `change.yaml`
instead of an interactive approval. Fixed with: a persistent single-current review
file per change/task, actor-classified findings, a five-value verdict decision table
with a pre-emit consistency check, a re-review baseline rule (previous review file's
own content, never git), and a new `/nevo-ai:spec-approve` command (backed by a new
`tools/specs.mjs approve` subcommand) that asks before writing `approved` — plus the
same closing-summary shape across all seven commands now, not just the review ones.
See [ADR-0004](../../../docs/adr/ADR-0004-review-artifacts-and-handoff.md).

This change was authorized in full by an owner-provided instruction document, copied
verbatim into this change directory as
[`origin-instruction.md`](origin-instruction.md) for traceability, which pre-approved the
file structure, responsibilities, and safety constraints below — see "Owner decisions"
for what remained open.

## Acceptance criteria

- Every new user-facing Claude command is namespaced `/nevo-ai:*`; no unqualified
  `/spec-*` or `/task-*` command exists.
- `docs/ai/specification-workflow.md` exists, is vendor-neutral, and passes
  `node tools/docs.mjs validate`.
- `.claude/skills/nevo-ai-spec-workflow/` exists with a concise `SKILL.md` (under 500
  lines) plus `references/` and `templates/` — detailed policy lives in `references/`,
  not inline in the skill or in every command.
- `.claude/agents/nevo-ai-spec-researcher.md` exists, is read-only, and cannot edit
  files, create specs, choose architecture, change task status, or create
  branches/commits.
- `.claude/commands/nevo-ai/` contains `spec-create`, `spec-refine`, `spec-review`,
  `spec-approve`, `task-next`, `task-start`, `task-review` — each a thin adapter that
  calls `tools/specs.mjs` / `tools/docs.mjs` for deterministic operations rather than
  reimplementing them.
- `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/nevo.mdc`, and
  `.github/copilot-instructions.md` gain only short navigation references to the shared
  workflow doc — no full workflow duplicated into any adapter.
- `README.md` gains a short "Working with AI" section pointing to `AGENTS.md` and
  `docs/ai/specification-workflow.md` (owner-requested during this change, see Owner
  decisions).
- `docs/ai/specification-workflow.md` includes a signal-based classification/escalation
  procedure and a "Solution option analysis" section (≥2 options required for
  architecture-gated decisions, do-not-default-to-simplest principle, consequences
  stated when options tie on cost) — vendor-neutral, so Cursor/Copilot benefit too.
- `docs/adr/ADR-0003-*.md` records why these two mechanisms were adopted and what was
  deliberately left out (DDD tactical/strategic modeling, artifact-lifecycle machinery).
- The Claude skill's `references/triage-policy.md` and
  `references/solution-option-analysis.md` point to that policy rather than duplicating
  it; `/nevo-ai:spec-create`, `spec-refine`, and `spec-review` are updated to use them.
- `docs/ai/specification-workflow.md` includes a "Review artifacts and handoff" section
  (actor-classified findings, the `reviews/` file convention, the five-value verdict
  decision table with consistency checks, the re-review baseline/lifecycle rule, gating
  vs. non-gating checks, and the approval-gate handoff) — vendor-neutral, per
  `docs/adr/ADR-0004-*.md`.
- `/nevo-ai:spec-review` and `/nevo-ai:task-review` write a persistent, single-current
  review file under `specs/active/<change>/reviews/`, treat that file's previous
  content (never `git status`/`git diff`) as the re-review baseline, and stay
  read-only otherwise; `/nevo-ai:spec-refine --from-review` applies `AUTO_FIX` findings
  directly and stops at `OWNER_DECISION`/`NEEDS_CLARIFICATION` ones.
- `/nevo-ai:spec-approve` exists and is the only place `approved` gets written, only
  after an explicit owner answer to a closed menu; `tools/specs.mjs` gained a matching
  `approve <change> <task>` subcommand. `/nevo-ai:task-review`'s `pass` verdict gets
  the same ask-then-act treatment for `complete`/`verify`.
- All seven `/nevo-ai:*` commands end with the shared `Status`/facts/`Artifact`/`Next`
  closing shape, defined once in `SKILL.md`.
- `node tools/docs.mjs validate` and `node tools/specs.mjs validate` pass.
- No file under `src/**`, `tests/**`, `examples/**`, `*.csproj`, `*.sln`,
  `Directory.Build.props`, `Directory.Packages.props`, `global.json`, or
  `.github/workflows/**` is modified.
- No commit, push, or pull request is created without explicit owner instruction.

## Owner decisions

- **Branch:** owner instructed starting this work on a new branch
  (`feature/nevo-ai-operational-workflow`) rather than reusing the already-merged
  `feature/ai-sdlc-bootstrap`.
- **Spec for consistency:** owner explicitly authorized recording this change as a spec
  under `specs/active/` "for consistency with the work being done," even though the
  instruction document that authorized the implementation was supplied outside the
  normal `/nevo-ai:spec-create` flow.
- **README section:** owner separately requested a "Working with AI" section in
  `README.md` describing how AI-assisted work happens in this repository — added to
  scope for this change rather than filed as a separate one, since it is a small,
  purely-additive documentation change directly about this same workflow.
- **`tools/specs.mjs` / `tools/docs.mjs` bug fix:** GitHub Copilot's review of PR #12
  flagged two context-path resolution concerns that turned out to be false positives
  (the CLI's `join('specs/active', slug, p)` logic resolves them correctly, independent
  of the task file's real subdirectory nesting — verified directly against the code).
  Investigating them surfaced a real, pre-existing defect: `parseScalar` read an inline
  `[]` as the literal string `"[]"` instead of an empty array, crashing
  `buildContextPacket`'s `.map()` for any task using `required: []` — including the
  original `architecture-documentation` task. Owner explicitly approved fixing this
  narrow parsing bug in `tools/specs.mjs` and `tools/docs.mjs` (same duplicated parser)
  as part of this change, despite the general rule that `tools/**` behavior changes need
  approval.
- **`tools/specs.mjs approve` subcommand:** no existing CLI path could transition a
  task from `draft` to `approved` (only `start`/`complete`/`verify`/`archive` existed).
  Two options were presented — add the CLI subcommand (mirrors `complete`/`verify`,
  keeps "status transitions always go through the CLI" intact) versus a direct
  hand-edit of `change.yaml` from `/nevo-ai:spec-approve` (no `tools/**` change, but
  inconsistent with that same principle). Owner chose the CLI subcommand.

## Out of scope

- Any change to `tools/specs.mjs` behavior beyond the owner-approved parser bug fix and
  the new `approve` subcommand noted above, or any change to `tools/docs.mjs` behavior
  beyond the parser bug fix (no schema changes, no other new CLI commands).
- Any change to the specification/document schema, valid status transitions, or branch
  naming rules.
- A Claude Code plugin — this is project-local commands/skills/agents only.
- Modifying source code, tests, examples, build configuration, or CI.

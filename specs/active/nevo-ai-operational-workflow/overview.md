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

This change was authorized in full by an owner-provided instruction document
(`01-add-nevo-ai-operational-workflow.md`), which pre-approved the file structure,
responsibilities, and safety constraints below — see "Owner decisions" for what remained
open.

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
  `task-next`, `task-start`, `task-review` — each a thin adapter that calls
  `tools/specs.mjs` / `tools/docs.mjs` for deterministic operations rather than
  reimplementing them.
- `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/nevo.mdc`, and
  `.github/copilot-instructions.md` gain only short navigation references to the shared
  workflow doc — no full workflow duplicated into any adapter.
- `README.md` gains a short "Working with AI" section pointing to `AGENTS.md` and
  `docs/ai/specification-workflow.md` (owner-requested during this change, see Owner
  decisions).
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

## Out of scope

- Any change to `tools/specs.mjs` or `tools/docs.mjs` *behavior* (schema, status
  transitions, CLI commands) — only documentation/help-text-level changes were
  permitted, and none were needed.
- Any change to the specification/document schema, valid status transitions, or branch
  naming rules.
- A Claude Code plugin — this is project-local commands/skills/agents only.
- Modifying source code, tests, examples, build configuration, or CI.

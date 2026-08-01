---
id: nevo-ai-operational-workflow.add-operational-layer
status: implemented
change: nevo-ai-operational-workflow
context:
  required: []
  optional:
    - ../../../AGENTS.md
    - ../../../docs/adr/ADR-0002-lightweight-markdown-workflow.md
allowed_paths:
  - .claude/**
  - docs/ai/**
  - AGENTS.md
  - CLAUDE.md
  - .cursor/**
  - .github/copilot-instructions.md
  - README.md
  - specs/active/**
  - specs/archive/**
  - tools/**
  - docs/index.generated.*
  - specs/*.generated.*
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - "*.csproj"
  - "*.sln"
  - Directory.Build.props
  - Directory.Packages.props
  - global.json
  - .github/workflows/**
---

# Task: Add the nevo-ai operational layer

## Goal

Create the `.claude/commands/nevo-ai/`, `.claude/skills/nevo-ai-spec-workflow/`, and
`.claude/agents/nevo-ai-spec-researcher.md` structure; create
`docs/ai/specification-workflow.md`; update navigation references in `AGENTS.md`,
`CLAUDE.md`, `.cursor/rules/nevo.mdc`, and `.github/copilot-instructions.md`; add a
"Working with AI" section to `README.md`.

## Acceptance criteria

- All files listed in the change overview's acceptance criteria exist with the required
  content and structure.
- `node tools/docs.mjs validate` reports no errors.
- `node tools/specs.mjs validate` reports no errors for this change.
- `tools/docs.mjs generate` / `tools/specs.mjs generate` produce valid generated
  indexes reflecting the new documents and this spec.
- No file outside `allowed_paths` is touched.

## Out of scope

- Modifying any `.csproj`, `.sln`, build-config, or source file.
- Modifying `tools/specs.mjs` / `tools/docs.mjs` behavior.
- Creating a Claude Code plugin.
- Committing, pushing, or opening a pull request as part of this task's own execution —
  those happen as an explicit, separate step once the owner has reviewed the diff.

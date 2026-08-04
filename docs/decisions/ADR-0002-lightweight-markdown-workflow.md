---
id: adr.0002-lightweight-markdown-workflow
type: adr
title: Use lightweight custom Markdown workflow for AI-assisted SDLC
status: accepted
date: 2026-08-01
supersedes: ~
superseded_by: ~
---

# ADR-0002: Use lightweight custom Markdown workflow for AI-assisted SDLC

## Status

Accepted

## Context

The repository needed a process for AI-assisted development that:
- Keeps the owner as the architectural decision maker
- Provides spec-anchored context for agents
- Works with Claude Code, Cursor, and GitHub Copilot without vendor lock-in
- Stays lightweight enough for a single-maintainer experimental project
- Can be removed later without damaging the codebase

Alternatives evaluated: OpenSpec with custom schema, BMAD, GitHub Spec Kit.

## Decision

Use a custom Markdown/YAML workflow with:
- `docs/` for durable architecture and development documentation
- `specs/active/` and `specs/archive/` for change specifications
- `tools/docs.mjs` and `tools/specs.mjs` as lightweight CLI tools
- `AGENTS.md` as the portable agent entry point
- Thin adapters for Claude (`CLAUDE.md`), Cursor (`.cursor/rules/`), Copilot (`.github/copilot-instructions.md`)

No external workflow framework is installed (no OpenSpec, BMAD, Spec Kit).

## Consequences

- The process schema is maintained by the repository owner
- Agents load only the context declared in task context packets
- Documentation has one source of truth (no parallel human/AI docs)
- The workflow can be removed by deleting `docs/`, `specs/`, `tools/`, and the adapter files
- CI validation of docs/specs can be added later via `node tools/docs.mjs check`

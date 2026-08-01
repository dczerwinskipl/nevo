---
id: spec.architecture-documentation
type: change
title: Architecture documentation
status: in-implementation
change: architecture-documentation
---

# Architecture documentation

## Goal

Capture current NEvo architecture in durable, machine-readable documents that agents can
load on demand. Establish the documentation structure for the AI-assisted SDLC process.

## Acceptance criteria

- `docs/architecture/` contains one document per major subsystem
- Each document has valid YAML front matter with `id`, `type`, `title`, `status`, `scope`,
  `read_when`, and `summary`
- Documents describe **current behavior**, not desired future state
- Experimental/incomplete modules are clearly marked
- Open architectural questions are explicitly noted (not guessed)
- `docs/development/` contains git workflow, commit conventions, PR rules, testing, local setup
- `docs/adr/` contains ADRs for bootstrap decisions
- `docs/ai/` contains navigation and execution policy for agents
- `node tools/docs.mjs validate` passes

## Out of scope

- Refactoring any code
- Changing any package dependencies
- Documenting desired future architecture (only current behavior)
- Integration tests (separate specification)
- CI/CD configuration (separate specification)

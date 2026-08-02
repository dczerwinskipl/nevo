---
id: architecture-documentation.core-architecture-docs
status: implemented
change: architecture-documentation
context:
  required: []
  optional:
    - ../../../docs/architecture/overview.md
allowed_paths:
  - docs/**
  - specs/active/architecture-documentation/**
  - AGENTS.md
  - CLAUDE.md
  - .cursor/**
  - .github/copilot-instructions.md
  - .github/pull_request_template.md
  - tools/**
  - specs/active/**
  - specs/archive/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
---

# Task: Core architecture documentation

## Goal

Create `docs/architecture/`, `docs/development/`, `docs/adr/`, and `docs/ai/` with
documents derived from code inspection. Create `specs/active/architecture-documentation/`
as the first real spec. Create `tools/docs.mjs` and `tools/specs.mjs`.

## Acceptance criteria

- All architecture documents in `docs/architecture/` pass `node tools/docs.mjs validate`
- Documents describe current behavior with evidence from the codebase
- Experimental modules (`event-sourcing`, `orchestration`) are explicitly marked
- Open questions are noted — not filled with assumptions
- `node tools/specs.mjs validate` reports no errors for this change
- `tools/docs.mjs generate` produces valid `docs/index.generated.json`

## Out of scope

- Modifying any `.csproj`, `.sln`, or source files
- Creating integration tests
- CI pipeline changes

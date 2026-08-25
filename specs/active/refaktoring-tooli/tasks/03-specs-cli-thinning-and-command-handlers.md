---
id: refaktoring-tooli.specs-cli-thinning-and-command-handlers
status: draft
change: refaktoring-tooli
context:
  required:
    - specs/active/refaktoring-tooli/overview.md
    - specs/active/refaktoring-tooli/owner-decisions.md
    - specs/active/refaktoring-tooli/areas/cli-architecture.md
    - docs/development/node-tooling-guidelines.md
    - tools/specs.mjs
    - tools/specs/**
  optional: []
allowed_paths:
  - tools/specs.mjs
  - tools/specs/commands/**
  - tools/tests/cli/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2]
  constraints: [C1, C2, C4, C5]
---

# Task: Specs CLI thinning and command handlers

## Goal

Reduce `tools/specs.mjs` from 1855 LOC to a thin command registration file (< 300 LOC), extract execution logic for all commands into dedicated modules in `tools/specs/commands/`, and standardize stdout/stderr output and exit code handling.

## Implementation constraints

- `tools/specs.mjs` should strictly handle:
  - Commander command and option registration.
  - Parsing and validating input arguments.
  - Dispatching to the appropriate function in `tools/specs/commands/*`.
  - Mapping exceptions to `stderr` and setting `process.exitCode = 1`.
- Create the command handler structure in `tools/specs/commands/`:
  - `commands/start.mjs`, `commands/approve.mjs`, `commands/complete.mjs`, `commands/verify.mjs`
  - `commands/status.mjs`, `commands/finalize.mjs`, `commands/archive.mjs`
  - `commands/batch.mjs`, `commands/follow-up.mjs`, `commands/self-check.mjs`
  - `commands/validate.mjs`, `commands/generate.mjs`, `commands/check.mjs`, `commands/pull-request-add.mjs`
- Preserve AI session auto-binding (`autoBindAgentSession`) as a clean helper function at the CLI entrypoint.
- Command handlers must not call `process.exit()` directly.

## Acceptance criteria

1. `tools/specs.mjs` is under 300 LOC. `inspection: line count tools/specs.mjs < 300`
2. All CLI commands behave identically in terms of flags, stdout, stderr, and exit codes. `automated: node --test tools/tests/cli/**/*.test.mjs`
3. All CLI tests and workflow integration tests pass cleanly. `automated: node --test tools/tests/**/*.test.mjs`

## Verification

```text
node --test tools/tests/cli/**/*.test.mjs
node tools/specs.mjs check
node tools/specs.mjs validate
```

## Out of scope

- Changing argument syntax or machine-readable output schemas of existing commands.

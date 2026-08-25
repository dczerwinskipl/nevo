---
id: refaktoring-tooli.specs-cli-boundary-and-command-orchestration
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
  - tools/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2]
  constraints: [C1, C2, C4, C5, C6]
---

# Task: Specs CLI boundary and command orchestration

## Goal

Separate the CLI boundary in `tools/specs.mjs` (command/option definitions, argument parsing, output formatting, exit code mapping) from application workflow orchestration by extracting command handlers into dedicated application modules.

## Problem

- `tools/specs.mjs` mixes CLI presentation concerns (Commander command/option configuration, argument validation) with deep application workflow execution, direct Git invocations, `console.log` / `console.error` writes, and process exit code mutations across 20+ commands.
- Deep reusable functions write directly to standard streams and modify `process.exitCode`, violating §2.1, §11, and §12 of `node-tooling-guidelines.md`.

## Expected outcome

- `tools/specs.mjs` serves strictly as a thin CLI entrypoint that registers commands, parses input, dispatches to application operations, formats stdout/stderr output, and sets `process.exitCode`.
- Command implementations are structured as standalone application modules under `tools/specs/commands/` (or cohesive domain modules) that return results or throw structured errors without touching `process.exit` or `process.exitCode`.
- AI session auto-binding (`autoBindAgentSession`) is retained as a clean boundary interceptor.

## Preserved contracts & behavior

- All CLI command signatures, flags, arguments, human-readable output, machine-readable JSON/YAML output, and exit codes must remain 100% backward compatible.
- External agent tooling workflows (`node tools/specs.mjs <command>`) must function identically.

## Verification

```text
node --test tools/tests/cli-*.test.mjs tools/tests/handler-testability.test.mjs
node tools/specs.mjs check
node tools/specs.mjs validate
```

## Out of scope

- Adding new CLI commands or changing existing flag syntax.

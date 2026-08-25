---
id: refaktoring-tooli.area.cli-architecture
type: area
change: refaktoring-tooli
---

# Area: CLI Architecture

## Responsibility

Owns the repository's public command-line interfaces (`tools/specs.mjs` and `tools/docs.mjs`), argument and option parsing, error mapping to exit codes, and stdout/stderr output formatting according to established standards.

## Current state

- `tools/specs.mjs` mixes Commander CLI option definitions with deep application workflow execution, direct `console.log` / `console.error` formatting, and process exit code mutations across 20+ commands.
- Deep functions write directly to standard streams and mutate `process.exitCode`, preventing clean reuse as pure application operations.

## Requirements

- Separate `tools/specs.mjs` into a thin CLI argument/option parsing and exit-code mapping boundary.
- Extract individual command orchestration handlers into dedicated application modules under `tools/specs/commands/`.
- Standardize the CLI output contract:
  - Command results sent to `stdout` (including stable machine-readable JSON/YAML output).
  - Warnings and diagnostics sent to `stderr`.
  - Exit code `0` on success, non-zero on failure, managed strictly at the CLI boundary.
  - Avoid direct `process.exit()` calls in deep application logic; use `process.exitCode` at the boundary.
- Retain AI session auto-binding (`autoBindAgentSession`) as a clean middleware interceptor at the CLI boundary.

## Interfaces and boundaries

The CLI boundary is the public tool contract for human developers and autonomous AI agents. All existing flags, arguments, and machine output schemas must retain 100% backward compatibility.

## Area-specific acceptance criteria

1. `tools/specs.mjs` serves strictly as a CLI definition, parsing, and exit-code mapping entrypoint.
2. Command operations are structured as standalone application modules testable without invoking `process.argv`.
3. All CLI tests and workflow integration tests pass cleanly.
4. Repository checks (`node tools/specs.mjs check`, `node tools/docs.mjs check`) complete without error.

## Out of scope

- Introducing new commands or altering existing CLI flag signatures.

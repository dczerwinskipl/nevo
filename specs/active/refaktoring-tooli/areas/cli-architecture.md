---
id: refaktoring-tooli.area.cli-architecture
type: area
change: refaktoring-tooli
---

# Area: CLI Architecture

## Responsibility

Owns the repository's public command-line interfaces (`tools/specs.mjs` and `tools/docs.mjs`), argument and option parsing, error mapping to exit codes, and stdout/stderr output formatting according to established standards.

## Current state

- `tools/specs.mjs` (1855 LOC) contains Commander definitions and complete implementations of all commands (generate, validate, check, list, next, context, fingerprint, approve, start, complete, verify, archive, finalize, status, comments, resolve-comment, pull-request-add, batch-*, follow-up-*, self-check).
- Handlers intertwine CLI argument parsing, Git execution, direct `console.log` / `console.error` formatting, `process.exitCode` assignments, and AI session auto-binding.
- Violates §2.1, §4, §14, and §15 of `node-tooling-guidelines.md`.

## Requirements

- Reduce `tools/specs.mjs` to a thin command registration and dispatch file (< 200–300 LOC).
- Extract individual command handlers into dedicated modules under `tools/specs/commands/`:
  - `commands/start.mjs`, `commands/approve.mjs`, `commands/complete.mjs`, `commands/verify.mjs`
  - `commands/status.mjs`, `commands/finalize.mjs`, `commands/archive.mjs`
  - `commands/batch.mjs`, `commands/follow-up.mjs`, `commands/self-check.mjs`
  - `commands/validate.mjs`, `commands/generate.mjs`, `commands/check.mjs`, `commands/pull-request-add.mjs`
- Standardize the CLI output contract:
  - Command results sent to `stdout` (including stable machine-readable JSON/YAML output).
  - Warnings and diagnostics sent to `stderr`.
  - Exit code `0` on success, non-zero on failure, managed strictly at the CLI boundary.
  - Avoid direct `process.exit()` calls in deep application logic; use `process.exitCode` at the boundary.
- Retain AI session auto-binding (`autoBindAgentSession`) as a clean middleware interceptor at the CLI boundary.

## Interfaces and boundaries

The CLI boundary is the public tool contract for human developers and autonomous AI agents. All existing flags, arguments, and machine output schemas must retain 100% backward compatibility.

## Area-specific acceptance criteria

1. `tools/specs.mjs` is under 300 LOC and contains only CLI definitions, dispatching, and error mappings.
2. Every command has a dedicated module in `tools/specs/commands/` testable without invoking `process.argv`.
3. All tests in `tools/tests/cli/` pass cleanly.
4. Repository checks (`node tools/specs.mjs check`, `node tools/docs.mjs check`) complete without error.

## Out of scope

- Introducing new commands or altering existing CLI flag signatures.

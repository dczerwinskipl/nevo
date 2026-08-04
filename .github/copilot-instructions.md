# NEvo — GitHub Copilot Instructions

Read `AGENTS.md` in the repository root before suggesting changes. This file defines the
change classes, decision policy, and context loading rules for this project.

## Key rules

- Architecture lives in `docs/development/` — do not invent architecture
- Specs live in `specs/active/` — do not implement unapproved work
- Breaking changes in behavior require owner approval, even if API signature is unchanged
- New external packages require owner approval
- Transaction semantics and persistence ownership require owner approval

## Workflow

The full, vendor-neutral specification workflow is `docs/ai/specification-workflow.md`,
driven by `tools/specs.mjs` and `tools/docs.mjs`. Follow that document and `AGENTS.md`
directly — this repository does not define Copilot-specific slash commands or prompts;
those are Claude-specific (`.claude/commands/nevo-ai/`) and should not be copied here.

## Project stack

- .NET 9, C# with preview features in core projects
- LanguageExt.Core (Either<Exception,T>, Option<T>) for error handling — follow this pattern
- xUnit + FluentAssertions + Moq for tests
- Entity Framework Core 9 for persistence (SQL Server)

## Code conventions

- Nullable reference types enabled — no `!` suppressions without comment
- Records for data/message types
- Async/await throughout with CancellationToken on all async methods
- `Either<Exception, T>` return types for operations that can fail (not exceptions)

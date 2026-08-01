# NEvo — Claude Code Instructions

Read `AGENTS.md` first. This file adds Claude-specific configuration only.

## Memory location

`C:\Users\domin\.claude\projects\D--repos-git-nevo\memory\`

## Project context

Working directory: `D:\repos\git\nevo`
Primary shell: PowerShell (Windows 11). Use PowerShell syntax in Bash tool calls.

## Mandatory first steps for any task

1. Run `node tools/specs.mjs next` to find the approved task (if starting new work).
2. Run `node tools/specs.mjs context <change> <task>` to get the context packet.
3. Load only what the context packet declares as `required`.
4. Do not commit, push, or create PRs without explicit owner instruction.

## Human-led rules

For any decision marked "Owner approval required" in `AGENTS.md`:
- Present the decision clearly
- Propose options with trade-offs
- Make a recommendation
- **Stop and wait** — do not proceed until the owner responds

## Tool preferences

- Read, Edit, Write, Grep, Glob over Bash where possible
- Use Bash for git commands and dotnet CLI
- Spawn Agent/Explore for codebase-wide searches (protect main context)

## Build and test commands

```bash
dotnet build
dotnet test
node tools/specs.mjs validate
node tools/docs.mjs validate
```

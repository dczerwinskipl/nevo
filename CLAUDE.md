# NEvo — Claude Code Instructions

Read `AGENTS.md` first. This file adds Claude-specific configuration only.

## Memory location

`C:\Users\domin\.claude\projects\D--repos-git-nevo\memory\`

## Project context

Working directory: `D:\repos\git\nevo`
Primary shell: PowerShell (Windows 11). Use PowerShell syntax in Bash tool calls.

## Repository command execution

Run repository commands directly from the repository root.

Do not prefix commands with `cd`, `cd /d`, `pushd`, or `git -C`.

Prefer simple, standalone commands such as:

```
node --test tools/tests/
node tools/specs.mjs validate
node tools/specs.mjs generate
node tools/specs.mjs check
git diff -- specs/active.generated.md specs/index.generated.json
```

Do not use `head`, `tail`, `grep`, pipes, `2>&1`, `&&`, semicolons, or multiple commands in one Bash call unless they are necessary.

Run independent commands as separate Bash calls.

Prefer:

```
node --test tools/tests/
```

Instead of:

```
cd /d/repos/git/nevo
node --test tools/tests/ 2>&1 | tail -150
```

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
node --test tools/tests/*.test.mjs   # tests for tools/*.mjs and .claude/hooks/*.mjs themselves
```

## `/nevo-ai:*` commands

The shared, vendor-neutral workflow lives in `docs/ai/specification-workflow.md`. Claude
Code exposes it through namespaced commands (`.claude/commands/nevo-ai/`), backed by the
shared skill `.claude/skills/nevo-ai-spec-workflow/` and the read-only
`nevo-ai-spec-researcher` subagent:

| Command | Purpose |
|---|---|
| `/nevo-ai:spec-create <change-id> <goal>` | Discover, then create a new specification after owner decisions |
| `/nevo-ai:spec-refine <change-id> [focus]` | Refine an existing active spec (no implementation) |
| `/nevo-ai:spec-review <change-id>` | Read-only implementation-readiness review |
| `/nevo-ai:spec-approve <change-id> [task-id]` | Interactive approval gate — confirms with the owner, then writes `approved` (its "approve and start" outcome also runs `start` in the same confirmation) |
| `/nevo-ai:task-next [filters]` | Return the next approved, ready task |
| `/nevo-ai:task-start <change-id> <task-id>` | Safely start one task and prepare its context |
| `/nevo-ai:task-review <change-id> <task-id>` | Review the working tree against one task |
| `/nevo-ai:task-apply-review <change-id> <task-id>` | Apply a review's AUTO_FIX findings, then auto re-review |
| `/nevo-ai:spec-audit <change-id> <focus>` | Read-only, cross-task thematic audit of an already-implemented change |
| `/nevo-ai:spec-resolve-comments <change-id>` | Fix and resolve clear PR review comments in one batch; flag the rest for you |
| `/nevo-ai:spec-finalize <change-id>` | Gate on PR/review/verification state, then merge + archive |
| `/nevo-ai:spec-status <change-id>` | Read-only: where the change sits in the whole chain, and the one next action |

Do not use unqualified `/spec-*` or `/task-*` commands — this repository only defines
the `nevo-ai` namespace.

**Use these instead of ad hoc `gh`/`git` calls — always, not only when the owner types
the literal slash command.** When a request matches one of the purposes above
(opening a PR, checking or resolving PR review comments, merging, checking what's
next), read that command's file under `.claude/commands/nevo-ai/` and follow its
instructions directly, even mid-conversation. Concretely: "sprawdź komentarze PR" /
"check PR comments" means read `spec-resolve-comments.md` and follow it — not `gh pr
view --comments` typed ad hoc. "What's next for this change" means run
`node tools/specs.mjs status <change-id>`, not reasoning through `list`/`git log`/`gh pr
view` by hand. These commands exist specifically because ad hoc equivalents have
already caused real problems this repository hit once (archiving a change before its PR
was even pushed — see `docs/ai/workflow-overview.md`) — improvising the same operation
a different way reopens exactly that risk.

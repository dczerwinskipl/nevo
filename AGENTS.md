# NEvo — Agent Guide

This file is the portable entry point for all AI agents. Claude, Cursor, and Copilot adapters
point here. Architecture lives in `docs/architecture/`. Do not duplicate it in adapter files.

## How to start any task

```bash
node tools/specs.mjs next              # find the next approved task
node tools/specs.mjs context <change> <task>   # get the context packet for a specific task
node tools/specs.mjs start <change> <task>     # create branch, set task in-implementation
```

Always run `next` or `context` before reading any spec files. Load only what the context
packet declares.

## Change classes

| Class | Examples | Spec required |
|---|---|---|
| **S — Small** | Typo, local rename, focused test for existing behavior | None |
| **T — Standard** | New middleware, internal contract change, test suite for an area | `specs/active/<slug>/spec.md` |
| **A — Architectural** | Persistence redesign, new public abstraction, package dependency change, API break | Full change directory with `change.yaml`, `overview.md`, `areas/`, `tasks/` |
| **E — Exploratory** | Branch review, behavior audit, spike | `specs/active/<slug>/discovery.md` → owner decides next class |

## Decision policy

**Agent decides independently:**
- Local variable names, method structure, internal helpers
- Test structure and assertion style within approved scope
- Middleware implementation details within approved design

**Agent decides and reports:**
- Non-obvious implementation choices inside an approved task

**Owner approval required before proceeding:**
- Public API shape
- Package dependency direction
- New external dependencies
- Transaction semantics
- Persistence ownership
- Message processing behavior changes
- Breaking changes (any behavior change, not just API)
- Compatibility decisions
- New packages or projects
- CI/CD pipeline changes

When in doubt: stop, describe the decision needed, present options, wait. For any
change classified T or larger that touches one of the items above, present at least two
meaningfully different options with trade-offs — never only the simplest one — and when
options cost the same, state what each unlocks and forecloses instead of picking
silently. See `docs/ai/specification-workflow.md` § "Solution option analysis" for the
full procedure, and § "Signal-based classification" for how S/T/A/E is decided.

## Context loading rules

Load only what the task context packet declares as `required`. Load `optional` context only
if the task description references it. Do not load all specs, all ADRs, or all architecture
docs by default.

Architecture documents: `docs/architecture/`
Development rules: `docs/development/`
AI guidance: `docs/ai/`
ADRs: `docs/adr/`

## Git safety

- Do not commit without explicit instruction
- Do not push without explicit instruction
- Do not create pull requests without explicit instruction
- Do not use `--no-verify`
- Do not mix unrelated changes in one commit
- Do not perform drive-by refactoring outside `allowed_paths`
- Show diff and verification results before asking to commit
- Opening a PR, checking/resolving its review comments, merging, and checking what's
  next each have a defined command in `docs/ai/specification-workflow.md` § "Tool
  adapters" (Claude Code: `.claude/commands/nevo-ai/`). Use those instead of improvising
  the same operation with raw `gh`/`git` calls — this is not a Claude-only convention,
  Cursor/Copilot/terminal use follows the same shapes directly from that document. See
  `docs/ai/workflow-overview.md` for the concrete incident (a change archived before its
  PR was even pushed) this rule exists to prevent from recurring a different way.

## Source of truth precedence

1. Approved specification for the current change
2. Accepted ADRs (`docs/adr/`)
3. Current architecture documentation (`docs/architecture/`)
4. Development rules (`docs/development/`)
5. Current implementation (code)
6. Generated indexes (`*.generated.*`)

If implementation conflicts with documented architecture, report it — do not silently choose.

## Specs directory structure

```
specs/active/<change-slug>/
  change.yaml          ← manifest: status, tasks, branch mode
  overview.md          ← goal, acceptance criteria, out-of-scope
  areas/<area>.md      ← area-specific requirements
  tasks/<n>-<id>.md    ← execution packet for one task
specs/archive/         ← completed and abandoned changes (do not load by default)
```

## Navigation guide

→ See `docs/ai/how-to-navigate.md` for detailed navigation instructions.
→ See `docs/ai/task-execution-policy.md` for task execution rules.
→ See `docs/ai/specification-workflow.md` for the full, vendor-neutral workflow this
  file summarizes.

## Tool-specific operational layers

Claude Code users may invoke the namespaced `/nevo-ai:*` commands (`spec-create`,
`spec-refine`, `spec-review`, `spec-approve`, `task-next`, `task-start`, `task-review`)
— see `CLAUDE.md`. Other agents (Cursor, Copilot, or anything else) follow this file and
`docs/ai/specification-workflow.md` directly, driving `tools/specs.mjs` and
`tools/docs.mjs` from the terminal. No agent, in any tool, may invent an owner decision
that these documents require to be asked explicitly.

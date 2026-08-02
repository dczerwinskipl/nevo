---
id: ai.specification-workflow
type: ai
title: NEvo specification workflow
status: current
read_when:
  - starting a new change
  - deciding how much specification a change needs
  - unsure whether a decision needs owner approval
summary: >
  Vendor-neutral description of NEvo's human-led, spec-anchored development process:
  how changes are classified, discovered, specified, decomposed into tasks, and
  implemented, and how tools/docs.mjs and tools/specs.mjs enforce it.
related:
  - ai.how-to-navigate
  - ai.task-execution-policy
  - adr.0002-lightweight-markdown-workflow
---

# NEvo specification workflow

This document is the single vendor-neutral source of truth for how AI agents plan and
execute changes in this repository. It applies equally to Claude Code, Cursor, GitHub
Copilot, and any other tool. Tool-specific adapters (`CLAUDE.md`, `.cursor/rules/`,
`.github/copilot-instructions.md`, and Claude's `/nevo-ai:*` commands) point here instead
of duplicating it.

The process itself — and the decision to build a lightweight custom workflow instead of
adopting an external framework — is recorded in
[ADR-0002](../adr/ADR-0002-lightweight-markdown-workflow.md).

## Principles

1. **Human-led.** The repository owner makes architectural and scope decisions. Agents
   propose options and a recommendation; they do not decide on the owner's behalf.
2. **Spec-anchored.** Non-trivial work is described in a specification before it is
   implemented. Agents load only the context a task declares as required, not the whole
   repository.
3. **Separation of specification and implementation.** Writing or refining a spec never
   implies starting implementation, and vice versa. Each is a distinct, explicit step.
4. **Deterministic where possible.** Status transitions, branch creation, and index
   generation go through `tools/specs.mjs` and `tools/docs.mjs`, not natural-language
   guesses.

## Change classification

Every change is classified before any artifact is created. See `AGENTS.md` for the
authoritative table; in summary:

| Class | Spec required |
|---|---|
| **S — Small** | None |
| **T — Standard** | `specs/active/<slug>/spec.md` (or an equivalent single-file spec) |
| **A — Architectural** | Full change directory: `change.yaml`, `overview.md`, optional `areas/`, `tasks/` |
| **E — Exploratory** | `specs/active/<slug>/discovery.md`, owner decides the next class |

When in doubt between two classes, prefer the smaller one and let refinement upgrade it
if the owner's decisions turn out to require more structure.

## Discovery before specification

Before proposing a specification, an agent must ground itself in the current repository
state:

- current behavior of the affected area (code, tests, examples),
- existing documentation (`docs/architecture/`, `docs/development/`, `docs/adr/`),
- whether an active or archived change already covers the same ground,
- constraints implied by accepted ADRs.

Broad, read-only exploration that would otherwise crowd the main context should be
delegated to a read-only research subagent (in Claude Code: `nevo-ai-spec-researcher`).
The researcher returns facts and evidence, not architecture decisions.

Discovery output separates:
- **facts** — directly observed in code or docs,
- **inferences** — reasonable conclusions drawn from facts,
- **inconsistencies** — places where sources disagree,
- **open questions** — things that must be asked, not guessed.

## Owner approval gates

Some decisions may never be inferred by an agent. The authoritative list lives in
`AGENTS.md` under "Decision policy" (public API shape, package dependency direction, new
external dependencies, transaction semantics, persistence ownership, message processing
behavior changes, breaking changes, compatibility decisions, new packages/projects,
CI/CD changes). When a change touches one of these, the agent presents options and a
recommendation, then stops and waits — it does not proceed on an assumed answer.

## Artifact decomposition

A specification should be no larger than it needs to be:

- A **Standard** change is a single spec file.
- An **Architectural** change splits into `areas/` when it has more than one
  independently implementable concern, so that each area (and each task inside it) can
  carry its own, smaller context packet.
- Do not create empty template sections or files "for completeness." Every artifact
  earns its place by reducing ambiguity or context size for the agent that implements it.

## Task context packets

Every implementable task carries `context.required`, `context.optional`,
`allowed_paths`, and `forbidden_paths` in its front matter. `tools/specs.mjs context
<change> <task>` resolves this into a JSON packet. Agents load `required` context before
touching code, load `optional` only if the task text references it, and treat
`allowed_paths`/`forbidden_paths` as a hard scope boundary — not a suggestion. This is
what keeps large specifications from forcing every task to read the entire change.

## Using `tools/specs.mjs`

```
node tools/specs.mjs generate                  # rebuild specs/*.generated.*
node tools/specs.mjs validate                  # validate all change manifests
node tools/specs.mjs check                     # validate + verify indexes are current
node tools/specs.mjs list                      # list active changes and task statuses
node tools/specs.mjs next                      # next approved, dependency-ready task → JSON
node tools/specs.mjs context <change> <task>   # context packet for one task → JSON
node tools/specs.mjs start <change> <task>     # create/switch branch, set task in-implementation
node tools/specs.mjs complete <change> <task>  # mark task implemented
node tools/specs.mjs verify <change> <task>    # mark task verified (owner-reviewed)
node tools/specs.mjs archive <change>          # move a fully terminal change to specs/archive/
```

`start` refuses to run on a dirty working tree. `next` only ever returns a task whose
status is `approved` and whose dependencies are all in a terminal status
(`implemented`, `verified`, `archived`, `abandoned`) — task selection is never a manual
scan of spec files.

## Using `tools/docs.mjs`

```
node tools/docs.mjs generate                          # rebuild docs/index.generated.*
node tools/docs.mjs validate                           # validate front matter across docs/
node tools/docs.mjs check                               # validate + verify index is current
node tools/docs.mjs find --scope <scope> [--type <type>] [--format json]
```

`docs.mjs` only scans `docs/`. Every document type (`architecture`, `development`,
`adr`, `ai`, `change`) has required front-matter fields enforced by `validate` — see
`tools/docs.mjs` for the exact list per type. `.claude/**` files are intentionally
outside this index: they are Claude-specific adapters, not shared documentation.

## Specification and implementation are separate steps

Producing or refining a specification never authorizes implementation. A specification
is "ready for implementation" only once:

- every task the owner intends to start next has `status: approved`,
- `depends_on` references are satisfied or clearly sequenced,
- `allowed_paths`/`forbidden_paths` are present and unambiguous,
- acceptance criteria are testable, not aspirational,
- `node tools/specs.mjs validate` (and `docs.mjs validate`, if docs changed) passes.

Implementation then proceeds task by task via `tools/specs.mjs start`, never by an agent
inferring that "the spec looks done."

## Architecture documentation and ADRs

`docs/architecture/` describes **current** behavior, not desired future state.
Experimental or incomplete modules must be marked as such rather than presented as
stable. A specification that changes durable architectural decisions must say so
explicitly and call out the ADR(s) it affects; new durable decisions are recorded as new
ADRs in `docs/adr/` (see `ADR-0001` for the commit-message convention this repository
follows, and `ADR-0002` for the workflow itself). Superseding an ADR is an owner
decision, not an inference.

## Active versus archived specifications

`specs/active/` holds every change currently being discovered, specified, or
implemented. `specs/archive/` holds changes whose tasks are all in a terminal status.
Archived specs are not loaded by default — only when a task explicitly references one,
when historical reasoning is requested, or when an ADR or active spec requires it. Never
start a task from `specs/archive/`.

## Git safety

- No commit, push, or pull request without explicit owner instruction.
- Never `--no-verify`, never force-push.
- No drive-by refactoring outside a task's `allowed_paths`.
- Branches are created via `tools/specs.mjs start`, not by hand, except where an agent
  has been explicitly authorized to create one outside the specs lifecycle.
- Show the diff and verification results before asking to commit.

Full detail: `docs/development/git-workflow.md` and `docs/development/commit-conventions.md`.

## Tool adapters

This document is the shared policy. Tool-specific layers are thin:

- **Claude Code** exposes `/nevo-ai:spec-create`, `/nevo-ai:spec-refine`,
  `/nevo-ai:spec-review`, `/nevo-ai:task-next`, `/nevo-ai:task-start`, and
  `/nevo-ai:task-review` (see `.claude/commands/nevo-ai/`), backed by the shared skill
  `.claude/skills/nevo-ai-spec-workflow/`. These commands call the same
  `tools/specs.mjs` / `tools/docs.mjs` CLIs described above — they do not implement a
  parallel workflow.
- **Cursor** and **Copilot** have no namespaced commands. They follow this document and
  `AGENTS.md` directly, driving `tools/specs.mjs` / `tools/docs.mjs` from the terminal.

No agent — regardless of tool — may invent an owner decision that this document requires
to be asked explicitly.

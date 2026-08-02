---
name: nevo-ai-spec-workflow
description: Shared NEvo workflow for human-led discovery, specification, task decomposition, review, and task execution. Used by the namespaced /nevo-ai:* commands.
user-invocable: false
---

# NEvo spec workflow (shared)

This skill is the internal playbook behind the `/nevo-ai:*` commands. It is not invoked
directly — the owner interacts through the namespaced commands, and each command loads
this file plus only the reference(s) it needs.

> `user-invocable: false` only hides this skill from the `/` menu — it stays loadable by
> Claude via the Skill tool, which is how the `/nevo-ai:*` commands pull it in. If this
> Claude Code build does not honor `user-invocable: false`, this file may still surface
> directly in the menu. Treat it as read-only background material in that case, not as
> something to run standalone — always prefer the `/nevo-ai:*` command for the phase you
> are in.

## The one source of truth

The workflow itself — change classes, owner approval gates, discovery rules, artifact
sizing, context packets, git safety — is defined in
[`docs/ai/specification-workflow.md`](../../../docs/ai/specification-workflow.md), and in
`AGENTS.md` for the decision-policy table. This skill does not repeat that content. Every
`/nevo-ai:*` command must have read `docs/ai/specification-workflow.md` (or already have
it in context) before acting.

## Phase → reference map

Load only the reference file(s) for the phase you are in — not all of them.

| Phase | Reference | When |
|---|---|---|
| Classifying a request (S/T/A/E) | `references/triage-policy.md` | `spec-create` at classification; `spec-refine`/`task-start` when re-checking mid-flight |
| Discovery | `references/discovery-policy.md` | Any command starting fresh discovery (`spec-create`, and `spec-refine`/`spec-review` when evidence is stale) |
| Comparing solution options for a gated decision | `references/solution-option-analysis.md` | Any command about to recommend a design once the change is T+ and touches an owner-approval gate |
| Presenting options / recording decisions | `references/decision-policy.md` | Any command about to ask the owner something, or record what they answered |
| Choosing artifact shape | `references/artifact-policy.md` | `spec-create` (initial structure), `spec-refine` (detecting oversized/undersized artifacts) |
| Loading context | `references/context-policy.md` | `task-next`, `task-start` |
| Judging readiness / diffs | `references/review-policy.md` | `spec-review`, `task-review` |

Templates in `templates/` are guides for artifact shape, not mandatory boilerplate —
each template states which of its sections may be omitted. Use them when creating or
restructuring specs, not as a checklist to paste verbatim.

## Non-negotiable stop conditions

Stop and wait for the owner — do not guess, do not proceed on the "likely" answer —
whenever:

- a decision falls under "Owner approval required" in `AGENTS.md`,
- a specification would leave an acceptance criterion untestable or a dependency
  ambiguous,
- an existing source of truth (spec vs. ADR vs. architecture doc vs. code) conflicts
  with another — report the conflict, do not silently pick one,
- a command is about to cross from specification into implementation, or from review
  into applying fixes, without the owner having asked for that explicitly.

Two more, specific to decision support (see `references/solution-option-analysis.md`):

- never present only the simplest option when the decision touches architecture,
  public API, or a package boundary — the owner chooses the trade-off, the agent does
  not pre-select it by omission,
- never silently pick between two options of materially equal cost — state what each
  unlocks and forecloses, and let the owner decide.

## Commands, this skill, and the CLI

```
owner
  │  invokes
  ▼
/nevo-ai:* command  (thin, in .claude/commands/nevo-ai/)
  │  reads
  ▼
this skill + the one reference it needs
  │  calls, for anything deterministic
  ▼
tools/specs.mjs / tools/docs.mjs
  │  delegates broad read-only exploration to
  ▼
nevo-ai-spec-researcher subagent (facts only, no decisions)
```

Commands never reimplement what the CLI already does deterministically (status
transitions, branch creation, index generation, readiness checks). If a command needs
information the CLI doesn't expose, read the specific file the context packet names —
never scan the whole `specs/` or `docs/` tree by default.

## Fact / inference / recommendation / decision separation

Every command that presents findings to the owner must keep these visually and
structurally separate:

- **Facts** — directly observed (file exists, field has this value, test asserts this).
- **Inferences** — a conclusion drawn from facts, clearly marked as such.
- **Recommendation** — the agent's suggested path, with trade-offs, never presented as
  already decided.
- **Owner decisions** — what was actually decided, recorded via
  `templates/owner-decisions.md`, never inferred from silence.

## Preventing premature implementation

`spec-create` and `spec-refine` never write source code, never run `tools/specs.mjs
start`, and never mark a task `approved`. `spec-review` and `task-review` never edit
files unless the owner explicitly asked for fixes to be applied — writing their own
`reviews/*.md` artifact is the one exception, and it is never the change/task/spec
files under review. `spec-approve` is the single place a task's `approved` status gets
written, and even there only after an explicit, interactive answer in the same turn —
never as a side effect of `spec-review` reaching a favorable verdict. The transition
from "specification" to "implementation" is always a separate, explicit owner-invoked
step (`/nevo-ai:task-start`, then the owner's explicit go-ahead to write code) — unless
the owner's answer to `spec-approve`'s menu explicitly authorized both in one shot.

## Ending every command's response

Every `/nevo-ai:*` command ends its response with the same four-line shape, so the owner
never has to parse prose to find the outcome or figure out what to run next. Define the
shape once here — commands and `references/*.md` point to this section instead of
restating it.

```
---
Status: <value from the command's status vocabulary below>
<2-5 short facts relevant to this command — counts, not prose>
Artifact: <file path(s) written this run, and/or repo state changed (branch created,
          task status transitioned) — or "none">
Next: <one exact, copy-pasteable /nevo-ai:* command — or "none — <why>">
---
```

Status vocabulary per command — fixed, no free-form synonyms in this line:

| Command | Status values |
|---|---|
| `spec-create` | `created` \| `updated` \| `blocked-on-decisions` |
| `spec-refine` | `refined` \| `blocked-on-decisions` \| `no-changes-needed` |
| `spec-review` | `blocked` \| `owner-decision-required` \| `changes-required` \| `ready-for-approval` \| `approved-for-implementation` |
| `spec-approve` | `approved` \| `not-approved` \| `shown-report` |
| `task-next` | `task-ready` \| `no-tasks-ready` |
| `task-start` | `prepared` \| `blocked` |
| `task-review` | `pass` \| `changes-required` \| `blocked` |

**Precise wording rule**: never use a more optimistic word than the Status value
justifies. Do not say "ready for implementation" when fixes, owner decisions, or task
approval are still pending — say `changes-required` and, in the facts line, spell out
what's pending (e.g. "2 auto-fix · 1 owner decision"). A verdict that overstates
readiness is worse than a blunt one; the owner acts on this line without reading the
full artifact.

`Artifact` and `Next` are never omitted even when there's nothing to report — write
`none` explicitly rather than dropping the line, so the shape stays predictable across
every command.

**`Status` is derived, never composed as a sentence.** A command whose outcome depends
on more than one condition (validation state, finding categories, task statuses...)
must evaluate those conditions against an explicit table with a fixed evaluation order,
and the table's output *is* the `Status` value — not an input the agent paraphrases.
`references/review-policy.md` § "Spec-review verdicts are derived, never chosen
narratively" is the worked example: it exists because a review once reported an
unresolved owner decision and "ready for owner approval" in the same response — two
locally-plausible sentences that were never checked against each other. Any command
with more than two possible `Status` values should have (or point to) a table with the
same shape: conditions in a fixed evaluation order, first match wins, and a short
consistency check run before the response is emitted.

## Preventing oversized specifications

Before writing a single large spec file, check whether the change has more than one
independently implementable concern. If it does, decompose into `areas/` and per-area
`tasks/` rather than one monolithic document — see `references/artifact-policy.md`. A
single task's context packet should stay small enough that an implementing agent does
not need to read the whole change to act on it.

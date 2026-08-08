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
| Judging a cross-task theme in an already-implemented change | `references/review-policy.md` § "Change-wide audits" | `spec-audit` |
| Orchestrating task-review depth across a range/list of tasks | `references/review-policy.md` § "Multi-task implementation review" | `implementation-review` |

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

`spec-create` and `spec-refine` never write source code, never run `tools/specs.mjs start`, and never mark a task `approved`. `spec-review`, `task-review`,
`spec-audit`, and `implementation-review` never edit files unless the owner explicitly
asked for fixes to be applied — writing their own `reviews/*.md` artifact (and, for
`spec-audit`, setting `audit_status` after its own closed-menu confirmation) is the one
exception, and it is never the change/task/spec files under review.
`implementation-review`'s own exception is narrower still: writing
`reviews/implementation-review-<scope>.md` and applying the one bulk status transition
the owner just confirmed (never a per-task status write, and never without that
confirmation) — it does not otherwise edit the tasks it reviews, and it never replaces
or weakens `task-review`/`spec-audit`. `spec-approve` is the single place a task's `approved` status gets
written, and even there only after an explicit, interactive answer in the same turn,
and the CLI's own approval gate (see `tools/specs.mjs approve` — draft-only, requires a
current, ready, fully-resolved review) is what actually enforces it, not the agent's
judgment. `spec-approve` offers exactly four outcomes — approve, approve and start, keep
as draft, show the report. For the first, third, and fourth, it **never** starts
implementation itself, even when the owner approves; it prints `/nevo-ai:task-start <change> <task>` as the next command and stops there. The fourth outcome, "approve and
start" (D3), is the one deliberate exception: it is its own explicit menu item — never
the default, never pre-selected, never inferred — and selecting it runs `approve` then
re-checks and runs `start` in the same turn (task 02/03's postcondition model governs
what happens if `start` can't complete; see `spec-approve.md` § "Approve and start").
Every other command in this skill still never starts implementation on its own
initiative. `spec-review` reaching `ready-for-approval` offers this same menu inline,
in the same turn, as an additional entry point into `spec-approve`'s gate — not a
bypass of it; the CLI call and its checks are unchanged either way.

## Ending every command's response

Every `/nevo-ai:*` command ends its response with a short, structured Markdown summary
— headings, bold labels, bullet points, a fenced code block for the next command —
never a single dense line of `Key: value · Key: value` pairs. Dense one-line summaries
read poorly in the Claude Code extension and VS Code's Markdown rendering and are easy
to skim past the one field that mattered. Define the shape once here — commands and
`references/*.md` point to this section instead of restating it.

### General shape (all commands)

```markdown
## <Command> result

**Status:** `<value from the command's status vocabulary below>`

- <fact label>: **<value>**
- <fact label>: **<value>**

**Artifact:** `<file path(s) written and/or repo state changed this run — or "none">`

**Next command:**

​```text
<exact, copy-pasteable /nevo-ai:* command>
​```
```

When there is nothing further to run, the fenced block reads exactly `No further action required.` instead of a command. Never omit the `Artifact` or `Next command` part —
write `none`/`No further action required.` explicitly rather than dropping the section,
so the shape stays predictable across every command.

### `/nevo-ai:spec-review`'s exact shape

`spec-review` does not use the general shape above — its richer field set (verdict
booleans, three separate unresolved-item counts) gets its own exact template, defined
in `references/review-policy.md` § "Chat output shape" (not duplicated here). Every
other review-like command (`task-review`, `spec-audit`) follows the same spirit —
headed sections, bold labels, a fenced `Next command` block — adapted to its own,
smaller field set; `spec-audit`'s exact shape is defined in
`references/review-policy.md` § "Change-wide audits" → "Chat output shape".

### Status vocabulary per command

Fixed, no free-form synonyms in the `Status`/`Verdict` line:

| Command | Status values |
|---|---|
| `spec-create` | `created` \| `updated` \| `blocked-on-decisions` |
| `spec-refine` | `refined` \| `blocked-on-decisions` \| `no-changes-needed` |
| `spec-review` | `blocked` \| `owner-decision-required` \| `changes-required` \| `ready-for-approval` \| `approved-for-implementation` |
| `spec-approve` | `approved` \| `not-approved` \| `shown-report` |
| `task-next` | `task-ready` \| `no-tasks-ready` |
| `task-start` | `prepared` \| `blocked` |
| `task-review` | `pass` \| `changes-required` \| `blocked` |
| `task-apply-review` | same as `task-review` (it re-runs that command's own flow) |
| `spec-audit` | `no-findings` \| `changes-recommended` \| `owner-decision-required` |
| `implementation-review` | `pass` \| `changes-required` \| `owner-decision-required` \| `blocked` |
| `spec-finalize` | `finalized` \| `pushed` \| `gate-passed` \| `blocked` |
| `spec-resolve-comments` | `resolved` \| `needs-owner-input` \| `none-unresolved` |
| `spec-status` | `needs-approval` \| `ready-to-start` \| `in-progress` \| `cannot-verify-pr` \| `needs-pr` \| `pr-draft` \| `needs-comment-resolution` \| `needs-verification-fixes` \| `ready-to-finalize` \| `done` |

**Precise wording rule**: never use a more optimistic word than the `Status`/`Verdict`
value justifies. Do not say "ready for implementation" when fixes, owner decisions, or
task approval are still pending — use the exact value (`changes-required`,
`owner-decision-required`, ...) and let the bullet list spell out what's pending. A
summary that overstates readiness is worse than a blunt one; the owner acts on this
block without reading the full artifact.

**`Status`/`Verdict` is derived, never composed as a sentence.** A command whose outcome
depends on more than one condition (validation state, finding categories, task
statuses...) must evaluate those conditions against an explicit table with a fixed
evaluation order, and the table's output *is* the value — not an input the agent
paraphrases. `references/review-policy.md` § "Spec-review verdicts are derived, never
chosen narratively" is the worked example: it exists because a review once reported an
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

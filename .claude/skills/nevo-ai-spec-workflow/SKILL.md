---
name: nevo-ai-spec-workflow
description: Shared NEvo workflow for human-led discovery, specification, task decomposition, review, and task execution. Used by the namespaced /nevo-ai:* commands.
user-invocable: false
disable-model-invocation: true
---

# NEvo spec workflow (shared)

This skill is the internal playbook behind the `/nevo-ai:*` commands. It is not invoked
directly — the owner interacts through the namespaced commands, and each command loads
this file plus only the reference(s) it needs.

> If this Claude Code build does not honor `user-invocable: false` /
> `disable-model-invocation: true`, this file may still surface directly. Treat it as
> read-only background material in that case, not as something to run standalone —
> always prefer the `/nevo-ai:*` command for the phase you are in.

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
| Discovery | `references/discovery-policy.md` | Any command starting fresh discovery (`spec-create`, and `spec-refine`/`spec-review` when evidence is stale) |
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
files unless the owner explicitly asked for fixes to be applied. The transition from
"specification" to "implementation" is always a separate, explicit owner-invoked step
(`/nevo-ai:task-start`, then the owner's explicit go-ahead to write code).

## Preventing oversized specifications

Before writing a single large spec file, check whether the change has more than one
independently implementable concern. If it does, decompose into `areas/` and per-area
`tasks/` rather than one monolithic document — see `references/artifact-policy.md`. A
single task's context packet should stay small enough that an implementing agent does
not need to read the whole change to act on it.

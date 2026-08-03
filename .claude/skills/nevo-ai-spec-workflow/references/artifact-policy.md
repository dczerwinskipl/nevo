# Artifact policy

## Small vs. standard vs. architectural artifact sets

Which class a change falls into is decided by the signal procedure in
`references/triage-policy.md`, not by matching the change against the examples below —
those examples exist to make the classes concrete, not to define them. Once classified,
the artifact set mirrors the change classes in `AGENTS.md`:

- **S — Small**: no spec artifact. Only use this when the change truly needs no
  discovery and no owner decision (a typo, a local rename, a test for existing behavior).
- **T — Standard**: a single spec file (`templates/standard-change.md`) — problem,
  current/desired behavior, constraints, owner decisions, acceptance criteria.
- **A — Architectural**: a full change directory — `change.yaml` manifest,
  `overview.md` (`templates/architectural-change.md`), optional `areas/<area>.md`
  (`templates/area.md`), and `tasks/<n>-<id>.md` (`templates/task.md`) per implementable
  unit of work.

## When to split by area

Split into `areas/` when the change has more than one concern that could reasonably be
implemented (and reviewed) independently — different modules, different layers, or work
that different tasks will touch without needing each other's full context. Do not split
a change that is really one cohesive unit just to produce more files.

## When an ADR is needed

A new ADR is needed when the change makes a durable architectural decision that future
changes will need to know about (a chosen pattern, a rejected alternative, a constraint
that isn't obvious from the code alone). A change that merely follows an existing ADR
does not need a new one. Superseding an existing ADR is an owner decision — propose it,
do not do it unilaterally.

## When architecture documentation must be updated

If a change alters *current* behavior that `docs/development/` describes, the same
change updates that document in the same branch — architecture docs describe current
behavior, not a future aspiration, so they cannot be left stale after merge.

## How to avoid empty boilerplate

Every template file in `templates/` states which sections may be omitted. Omit them —
do not paste a template with placeholder text like "N/A" or "TBD" just to look complete.
An empty `areas/` directory or a task file with no real acceptance criteria is worse than
not creating the file at all.

## Active / archive rules

New specs are always created in `specs/active/`. Never create directly in
`specs/archive/`. A change moves to `specs/archive/` only via `node tools/specs.mjs
archive <change>`, which itself refuses to run unless every task is in a terminal status.

A change reaching "every task terminal" is not self-executing — nothing archives it
automatically, and a terminal task alone does not mean the work is done (a review, a
follow-up task, or more discovery may still be planned). `/nevo-ai:task-review` is the
command responsible for offering to archive, in the same interactive turn, the moment its
own status transition makes a change fully terminal (see that command's step 9a).
`/nevo-ai:task-next` is the read-only backstop: it surfaces (never archives) any change
under `specs/active/` that is fully terminal but wasn't archived through that offer —
e.g. because the transition happened outside `task-review`, or the owner declined at the
time.

## Source-of-truth precedence

When artifacts disagree, resolve using the precedence in `AGENTS.md` ("Source of truth
precedence"): approved spec for the current change → accepted ADRs → current
architecture docs → development rules → current implementation → generated indexes.
Report conflicts rather than silently picking a level to trust.

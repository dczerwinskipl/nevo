---
id: deterministic-status-architecture.lifecycle-skill-instruction-split
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/skills-instruction-split.md
allowed_paths:
  - .claude/skills/nevo-ai-spec-workflow/SKILL.md
  - .claude/skills/nevo-ai-spec-workflow/references/lifecycle-instructions.md
forbidden_paths:
  - tools/specs/**
  - tools/dashboard/**
  - src/**
  - .claude/commands/**
depends_on: [ legacy-mutation-guard, deterministic-mutation-guard, workflow-task-publish-operation, step-executor-guard, human-step-execution-operations ]
---

# Task: Lifecycle skill instruction split

## Goal

Audit the shared spec-workflow skill for legacy-lifecycle assumptions embedded in otherwise
shared sections, move them into an explicit legacy instruction set, and add a matching
explicit deterministic instruction set — including the executor invariant and the fact that
a wrong-mode command fails/reroutes rather than silently executing.

## Dependencies

`legacy-mutation-guard`, `deterministic-mutation-guard`, `workflow-task-publish-operation`,
`step-executor-guard`, `human-step-execution-operations` — the instruction set names the
command surfaces and guards these tasks introduce.

## Implementation constraints

- Read `SKILL.md` end to end and identify any sentence/section that states or implies a
  legacy-lifecycle command or behavior universally (without a mode conditional) where a
  deterministic spec would actually behave differently — move each one found into the new
  legacy instruction set below rather than leaving it in the shared section.
- Add one new reference file (e.g. `references/lifecycle-instructions.md`) stating the two
  allow/forbid sets from `areas/skills-instruction-split.md`, and link it from `SKILL.md`'s
  phase→reference map rather than inlining it into `SKILL.md` itself.
- State explicitly that a wrong-mode lifecycle command invocation fails/reroutes at the CLI
  layer (naming `areas/lifecycle-boundary-guards.md`/`areas/step-executor-model.md`) rather
  than silently executing legacy behavior on a deterministic spec.
- State explicitly that a deterministic task-execution agent must never attempt to
  start/finish a human-owned step (`executor: human`) — cross-referencing, not restating,
  `docs/development/agent-workflow-protocol.md`'s existing protocol.
- Do not modify any `.claude/commands/nevo-ai/*.md` command file in this task —
  `forbidden_paths` enforces this; if a command file's wording turns out to need updating,
  that is a follow-up, not silent scope creep here.

## Acceptance criteria

- Every legacy-lifecycle assumption found embedded in a shared `SKILL.md` section is moved
  (not duplicated) into the new legacy instruction set — a diff shows removal from the
  shared section and addition to the new reference file for each one found.
  `inspection: confirm each identified embedded assumption was moved, not copied`
- The new reference file states, explicitly: legacy allowed (`approve`/`start`/`complete`/
  `verify`, existing `/nevo-ai:*` commands) / forbidden (`workflow task publish`,
  `workflow step start`, `workflow step finish`, `startHumanStep`, `submitHumanStepResult`);
  deterministic allowed (`workflow task publish`, `workflow step start`,
  `workflow step finish`, `startHumanStep`, `submitHumanStepResult`, each subject to the
  executor guard) / forbidden (legacy `approve`/`start`/`complete`/`verify`).
  `inspection: confirm both allow/forbid lists are present and match the area doc exactly`
- The reference file states the wrong-mode-command-fails and never-start-a-human-owned-step
  rules explicitly. `inspection: confirm both statements are present`
- `node tools/docs.mjs check` confirms no `docs/index.generated.*` change results from this
  task (`.claude/**` is outside the docs index).
  `automated: node tools/docs.mjs check`

## Verification

```bash
node tools/docs.mjs check
```

## Documentation impact

None beyond the skill files themselves (`.claude/**` is intentionally outside
`docs/index.generated.*`).

## Out of scope

Any change to `.claude/commands/nevo-ai/*.md` or the `nevo-ai-spec-researcher` subagent.

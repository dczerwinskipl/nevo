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
depends_on: [ legacy-mutation-guard, deterministic-mutation-guard, workflow-task-publish-operation ]
---

# Task: Lifecycle skill instruction split

## Goal

Add a normative, explicit legacy-vs-deterministic lifecycle-mutation instruction set to the
shared spec-workflow skill, after `workflow.mode` resolution, without duplicating the
skill's shared discovery/authoring/decision-policy content.

## Dependencies

`legacy-mutation-guard`, `deterministic-mutation-guard`, `workflow-task-publish-operation`
— the instruction set names the command surfaces these tasks introduce/guard.

## Implementation constraints

- Add one new reference file (e.g. `references/lifecycle-instructions.md`) stating the two
  allow/forbid sets from `areas/skills-instruction-split.md`, and link it from `SKILL.md`'s
  phase→reference map rather than inlining it into `SKILL.md` itself.
- Do not touch `SKILL.md`'s existing discovery/authoring/decision-policy sections beyond
  adding the one new map row and a short pointer.
- Do not modify any `.claude/commands/nevo-ai/*.md` command file in this task —
  `forbidden_paths` enforces this; if a command file's wording turns out to need updating,
  that is a follow-up, not silent scope creep here.
- Reference (do not restate) `docs/development/agent-workflow-protocol.md`'s existing
  deterministic execution protocol for deterministic task-execution agents.

## Acceptance criteria

- The new reference file states, explicitly: legacy allowed (`approve`/`start`/`complete`/
  `verify`, existing `/nevo-ai:*` commands) / forbidden (`workflow task publish`,
  `workflow step start`, `workflow step finish`, deterministic human-workflow operations);
  deterministic allowed (`workflow task publish`, `workflow step start`,
  `workflow step finish`, deterministic human-workflow operations) / forbidden (legacy
  `approve`/`start`/`complete`/`verify`).
  `inspection: confirm both allow/forbid lists are present and match the area doc exactly`
- `SKILL.md`'s discovery/authoring/decision-policy section content is unchanged (diff shows
  only the new map row and pointer). `inspection: diff SKILL.md against its pre-task content outside the phase-reference table`
- `node tools/docs.mjs validate` is not applicable (`.claude/**` is outside the docs index)
  — confirm no `docs/index.generated.*` change results from this task.
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

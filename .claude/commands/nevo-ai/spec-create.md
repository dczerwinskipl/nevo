---
description: Create a new human-led NEvo specification after repository discovery and explicit owner decisions.
argument-hint: <change-id> <goal>
disable-model-invocation: true
---

Read the shared skill `nevo-ai-spec-workflow` (`.claude/skills/nevo-ai-spec-workflow/SKILL.md`)
if not already in context, plus `docs/ai/specification-workflow.md` and `AGENTS.md`.

Arguments (`$ARGUMENTS`): `<change-id> <goal>` — a stable kebab-case slug and a short goal
statement.

## Flow

1. Parse `<change-id>` and `<goal>` from `$ARGUMENTS`. Validate the id is a stable
   kebab-case slug.
2. Check whether `<change-id>` already exists under `specs/active/` or `specs/archive/`
   (`node tools/specs.mjs list`, and a directory check for archive). If it does, stop and
   report the collision instead of creating a duplicate.
3. Use `node tools/docs.mjs find --scope <scope> --format json` (and `docs/index.generated.md`
   if present) to resolve documentation likely relevant to the goal.
4. Classify the change using the classes in `AGENTS.md` (S/T/A/E) — read
   `references/artifact-policy.md` for the sizing rules behind this call.
5. Perform discovery per `references/discovery-policy.md`. Delegate broad read-only
   exploration to the `nevo-ai-spec-researcher` subagent when it would otherwise crowd
   this session's context (facts and evidence only — it does not decide anything).
6. Present, per `references/decision-policy.md`: repository facts, current behavior,
   affected areas, constraints, open questions, meaningful options, one recommendation,
   and the specific owner decisions required.
7. **Stop and wait for the owner** whenever a material decision is required. Do not
   proceed on an assumed answer.
8. After the owner has explicitly answered:
   - record the decisions using `templates/owner-decisions.md`,
   - choose the smallest sufficient artifact structure per `references/artifact-policy.md`,
   - create the change directory under `specs/active/<change-id>/` matching the schema
     already used in this repo (`change.yaml`, `overview.md`, optional `areas/`,
     `tasks/<n>-<id>.md`) — use `templates/standard-change.md`,
     `templates/architectural-change.md`, `templates/area.md`, and `templates/task.md` as
     guides, omitting sections they mark as optional,
   - decompose large work into cohesive areas/tasks rather than one monolithic file,
   - run `node tools/specs.mjs validate` (and `node tools/docs.mjs validate` if docs were
     touched).
9. Report: created/updated files, recorded owner decisions, any decisions still
   unresolved, validation results, and the recommended next command
   (typically `/nevo-ai:spec-review <change-id>`).

## Non-negotiable rules

- Do not implement source changes.
- Do not start a task (`tools/specs.mjs start`) — that is `/nevo-ai:task-start`.
- Do not create a branch unless the repository's approved workflow explicitly requires a
  specification branch and the owner has approved it — normally no branch is created at
  this stage.
- Do not mark a specification `approved` on the owner's behalf.
- Do not invent architecture the owner hasn't decided.
- Do not create one large file when multiple independently implementable areas would
  reduce context — see `references/artifact-policy.md`.
- Do not create empty template files or sections that aren't required.

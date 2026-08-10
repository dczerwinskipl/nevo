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
4. Classify the change using the signal procedure in `references/triage-policy.md`
   (S/T/A/E) — show the signal table (rating + one-sentence reason per signal) in the
   report, not just the conclusion.
5. Perform discovery per `references/discovery-policy.md`, including the
   existing-solution check. Delegate broad read-only exploration to the
   `nevo-ai-spec-researcher` subagent when it would otherwise crowd this session's
   context (facts and evidence only — it does not decide anything).
6. If the change is **T or larger** and touches an owner-approval gate (`AGENTS.md`),
   run `references/solution-option-analysis.md` before presenting anything: at least two
   meaningfully different options, not the simplest one only, with the
   consequences-at-equal-cost rule applied.
7. Present, per `references/decision-policy.md`: repository facts, current behavior,
   affected areas, constraints, open questions (classified Blocking/Non-blocking/
   Implementation-detail), the solution options from Step 6 when applicable (or simpler
   meaningful options for ungated decisions), one recommendation with rejection reasons
   for the alternatives, and the specific owner decisions required. Use the confirmation
   menu from `references/decision-policy.md` when asking the owner to choose a
   direction.
8. **Stop and wait for the owner** whenever a material decision is required. Do not
   proceed on an assumed answer.
9. After the owner has explicitly answered:
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
## Ending the response

Use the closing shape from `SKILL.md` § "Ending every command's response": `Status` is
`created` (new change directory), `updated` (an existing draft was extended), or
`blocked-on-decisions` (stopped at step 8 awaiting the owner). The facts line names
recorded vs. unresolved owner decisions. `Artifact` lists the created/updated files.
`Next` is `/nevo-ai:spec-review <change-id>` once artifacts exist, or the specific
pending question if `blocked-on-decisions`.

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

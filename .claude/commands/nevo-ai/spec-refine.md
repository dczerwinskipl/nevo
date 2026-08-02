---
description: Refine an existing active NEvo specification without implementing it.
argument-hint: <change-id> [focus]
disable-model-invocation: true
---

Read the shared skill `nevo-ai-spec-workflow` (`.claude/skills/nevo-ai-spec-workflow/SKILL.md`)
if not already in context, plus `docs/ai/specification-workflow.md`.

Arguments (`$ARGUMENTS`): `<change-id> [focus]` — the active change slug, and an optional
focus area to narrow the refinement.

## Flow

1. Resolve the active change via `node tools/specs.mjs list` / `node tools/specs.mjs
   context <change-id> <task-id>` as needed. Stop if `<change-id>` is not found in
   `specs/active/`.
2. Read its `change.yaml` manifest and current artifacts (`overview.md`, `areas/`,
   `tasks/`).
3. Load only related docs and ADRs — do not load the whole `docs/` tree
   (`references/context-policy.md`).
4. Detect, per `references/artifact-policy.md` and `references/review-policy.md`:
   unresolved owner decisions, missing or untestable acceptance criteria, oversized
   artifacts, missing area decomposition, duplicated requirements, task context bloat,
   unclear dependencies, documentation impact, migration/compatibility gaps.
5. Present the proposed refinements using the facts/inferences/recommendation/decision
   separation from `references/decision-policy.md`.
6. **Wait for owner approval** before applying any refinement that changes behavior,
   scope, acceptance criteria, or architecture. Purely editorial fixes (typos, broken
   links, formatting) may be applied and reported without a stop, if the owner's
   invocation didn't already scope this command to read-only review.
7. Apply only the approved updates. Record any new owner decisions via
   `templates/owner-decisions.md`.
8. Run `node tools/specs.mjs validate` (and `node tools/docs.mjs validate` if docs were
   touched).
9. Do not implement code — this command only edits specification artifacts under
   `specs/active/<change-id>/`.

Report: what was refined, what still needs an owner decision, and validation results.

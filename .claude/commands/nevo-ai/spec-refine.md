---
description: Refine an existing active NEvo specification without implementing it.
argument-hint: <change-id> [focus | --from-review]
disable-model-invocation: true
---

Read the shared skill `nevo-ai-spec-workflow` (`.claude/skills/nevo-ai-spec-workflow/SKILL.md`)
if not already in context, plus `docs/ai/specification-workflow.md`.

Arguments (`$ARGUMENTS`): `<change-id> [focus]` — the active change slug, and an optional
focus area to narrow the refinement — **or** `<change-id> --from-review` (the trailing
word `latest` is accepted and ignored, e.g. `--from-review latest`, for compatibility
with that phrasing — there is only ever one current review file, see below, so there is
no actual "latest" to select among).

## `--from-review` mode

If `$ARGUMENTS` contains `--from-review`:

1. Read `specs/active/<change-id>/reviews/spec.md`. If it doesn't exist, stop and tell
   the owner to run `/nevo-ai:spec-review <change-id>` first — do not improvise findings
   from memory of an earlier conversation.
2. Parse its `## Findings` table. For every `AUTO_FIX` finding: apply it directly (no
   stop), and list exactly what changed in the response. For every `OWNER_DECISION` or
   `NEEDS_CLARIFICATION` finding: present it per `references/decision-policy.md` and
   **stop and wait** — do not apply any refinement tied to it until answered. Leave
   `NON_BLOCKING`/`INFORMATIONAL` findings untouched unless the owner explicitly asks
   for them too.
3. After applying the `AUTO_FIX` findings (and any `OWNER_DECISION`/
   `NEEDS_CLARIFICATION` findings the owner just resolved), run `node tools/specs.mjs
   validate` (and `docs.mjs validate` if docs changed), then skip to the closing summary
   below — do not re-run the rest of this file's general-purpose flow (steps 4-8) on top
   of a review-driven pass; `/nevo-ai:spec-review` is what re-evaluates readiness, not
   this command.
4. Recommend `/nevo-ai:spec-review <change-id>` as the next command — a stale
   `reviews/spec.md` describing pre-fix state is misleading, so re-review rather than
   trusting the old verdict.

Otherwise (no `--from-review`), run the general flow below.

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
   unclear dependencies, documentation impact, migration/compatibility gaps, and — per
   `references/review-policy.md` — a gated decision that only has a single proposed
   approach instead of a real option analysis.
5. Re-run the signal evaluation from `references/triage-policy.md` if refinement reveals
   information that wasn't available at classification time. If a signal flips (e.g. the
   change turns out to touch a public contract), this is an **escalation** — name the
   flipped signal explicitly to the owner and follow the escalation rule in
   `docs/ai/specification-workflow.md` rather than quietly restructuring the spec under
   the old classification.
6. If refinement surfaces a gated concern (`AGENTS.md` owner-approval list) that the
   spec doesn't yet have an option analysis for, run
   `references/solution-option-analysis.md` before proposing the refinement.
7. Present the proposed refinements using the facts/inferences/recommendation/decision
   separation from `references/decision-policy.md`.
8. **Wait for owner approval** before applying any refinement that changes behavior,
   scope, acceptance criteria, or architecture. Purely editorial fixes (typos, broken
   links, formatting) may be applied and reported without a stop, if the owner's
   invocation didn't already scope this command to read-only review.
9. Apply only the approved updates. Record any new owner decisions via
   `templates/owner-decisions.md`.
10. Run `node tools/specs.mjs validate` (and `node tools/docs.mjs validate` if docs were
    touched).
11. Do not implement code — this command only edits specification artifacts under
    `specs/active/<change-id>/`.

## Ending the response

Use the closing shape from `SKILL.md` § "Ending every command's response":
`Status` is `refined` (something changed), `blocked-on-decisions` (stopped on an
unresolved `OWNER_DECISION`/`NEEDS_CLARIFICATION` finding or gate), or
`no-changes-needed` (nothing to refine). The facts line names what was refined or what's
still open. `Artifact` lists the changed file(s), or `none`. `Next` is
`/nevo-ai:spec-review <change-id>` after any refinement, or the specific question still
awaiting an answer if `blocked-on-decisions`.

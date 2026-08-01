---
description: Read-only implementation-readiness review of a NEvo specification.
argument-hint: <change-id>
disable-model-invocation: true
---

Read the shared skill `nevo-ai-spec-workflow` (`.claude/skills/nevo-ai-spec-workflow/SKILL.md`)
if not already in context, plus `references/review-policy.md`.

Arguments (`$ARGUMENTS`): `<change-id>`.

## Flow

1. Resolve `<change-id>` under `specs/active/`. Read `change.yaml` and all its artifacts.
2. Run `node tools/specs.mjs validate` to get mechanical dependency/cycle/id checks for
   free — do not re-derive those by hand.
3. Evaluate readiness per `references/review-policy.md` — "Specification readiness
   criteria."
4. Produce a structured review using `templates/review-report.md` as a guide, covering:
   readiness verdict, blocking issues, owner decisions still required, ambiguity/
   assumption risks, architecture conflicts, acceptance-criteria quality, task
   decomposition quality, task dependency correctness, context-packet quality,
   allowed/forbidden-path quality, documentation/ADR impact, and implementation
   readiness per task.

## Rules

- This command is **read-only by default**. Do not edit any file.
- Do not approve the change on the owner's behalf, and do not change any status.
- If the owner explicitly asks this invocation to also apply fixes, apply only the
  specific fixes requested, then re-report — do not expand into a general refinement
  pass (use `/nevo-ai:spec-refine` for that).

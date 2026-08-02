---
description: Review the current working tree against one approved NEvo task.
argument-hint: <change-id> <task-id>
disable-model-invocation: true
---

Read `references/review-policy.md` from the shared skill if not already in context.

Arguments (`$ARGUMENTS`): `<change-id> <task-id>`.

## Flow

1. Run `node tools/specs.mjs context <change-id> <task-id>` to resolve the task's
   context, `allowed_paths`, and `forbidden_paths`.
2. Inspect `git diff` / `git status` for the changed files.
3. Verify the diff stays within `allowed_paths` and does not touch `forbidden_paths`.
4. Compare the implementation to: the task's acceptance criteria, its area's
   requirements (if any), change-wide constraints, applicable ADRs, and architecture
   documentation.
5. Check behavior, tests, documentation impact, breaking changes, unrelated edits,
   generated artifacts (`*.generated.*` should only change via `tools/docs.mjs
   generate` / `tools/specs.mjs generate`), and verification evidence (build/test
   output — ask for it if not shown).
6. Produce a report using `templates/review-report.md` as a guide: pass/fail verdict,
   blockers, non-blocking findings, missing tests, missing documentation, and the
   recommended task status transition.

## Rules

- Do not change task status automatically — recommend the transition; the owner (or an
  explicit follow-up instruction) applies it via `node tools/specs.mjs complete
  <change-id> <task-id>` or `verify`.
- Do not commit.

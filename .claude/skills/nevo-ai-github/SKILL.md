---
name: nevo-ai-github
description: Use this skill for any GitHub/PR question or action on a NEvo change once a task's work is done — "what's next for this change", "check/read the PR comments", "resolve the review comments" (including GitHub Copilot's), "is this ready to merge", "merge this", "finalize this change", or any other request to interact with a NEvo change's GitHub/PR state. Routes to the correct deterministic node tools/specs.mjs command instead of ad hoc `gh` calls — do not use `gh` directly for anything this table covers.
---

# NEvo GitHub workflow (routing skill)

This skill exists because the deterministic commands below already existed but weren't
being used — without an explicit trigger like this one, a request phrased in plain
language ("sprawdź komentarze PR", "czy to gotowe do mergea") had nothing pulling it
toward the right command, so it got answered with ad hoc `gh`/`git` calls instead. That
already caused a real incident (a change archived before its PR was even pushed — see
`docs/ai/workflow-overview.md`). Use this table before reaching for `gh` directly.

## Routing table

| The owner asks... | Read and follow |
|---|---|
| "what's next for this change" / "where are we" / "is this ready" | `.claude/commands/nevo-ai/spec-status.md` (read-only) |
| "open a PR" / "create a PR" / "stwórz PR" | `.claude/skills/pr-create/SKILL.md` |
| "check the PR comments" / "what did Copilot say" (read-only) | `.claude/commands/nevo-ai/spec-resolve-comments.md`, steps 1–4 only |
| "resolve the comments" / "fix what Copilot flagged" | `.claude/commands/nevo-ai/spec-resolve-comments.md`, full flow |
| "merge this" / "finalize" / "close this out" | `.claude/commands/nevo-ai/spec-finalize.md` |
| Any other cross-task audit ("are the examples good", "review the whole change for X") | `.claude/commands/nevo-ai/spec-audit.md` |

Each of those files is a complete, self-contained flow — read the whole file, then
follow it, the same as if the owner had typed the literal `/nevo-ai:*` command. This
skill does not duplicate their steps; it only exists to be found.

## Rules

- Never call `gh` directly for anything in the table above. If a request doesn't match
  any row (e.g. inspecting an unrelated repo, a one-off `gh` question with no NEvo
  change involved), plain `gh` is fine — this skill only covers NEvo change lifecycle
  operations.
- If `node tools/specs.mjs status <change-id>` reports the change isn't in
  `specs/active/`, it may already be in `specs/archive/` — `spec-status`,
  `spec-finalize`, and `spec-resolve-comments` all check both locations, so this is not
  a reason to fall back to `gh` by hand.
- `gh` must be installed and authenticated for anything except `spec-status` while tasks
  are still non-terminal (that path never touches git/GitHub at all). If `gh` isn't
  available, say so plainly — do not try to reconstruct PR/comment state by other means
  (e.g. fetching the GitHub web page) and presenting it as equivalent; it isn't the same
  deterministic check the gate relies on.

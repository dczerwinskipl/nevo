---
name: nevo-ai-github
description: Use this skill for any GitHub/PR question or action on a NEvo change — "create a PR", "open a pull request", "stwórz PR", "what's next for this change", "check/read the PR comments", "resolve the review comments" (including GitHub Copilot's), "is this ready to merge", "merge this", "finalize this change", or any other request to interact with a NEvo change's GitHub/PR state. Routes to the correct deterministic node tools/specs.mjs command (or the PR-drafting flow below) instead of ad hoc `gh` calls — do not use `gh` directly for anything this file covers.
---

# NEvo GitHub workflow

This skill exists because the deterministic commands it routes to already existed but
weren't being used — without an explicit trigger like this one, a request phrased in
plain language ("sprawdź komentarze PR", "czy to gotowe do mergea") had nothing pulling
it toward the right command, so it got answered with ad hoc `gh`/`git` calls instead.
That already caused a real incident (a change archived before its PR was even pushed —
see `docs/ai/workflow-overview.md`). Use this file before reaching for `gh` directly.

It was also, until recently, two separate skills — a standalone `pr-create` with no
`nevo-ai-*` naming and no link to the rest of this workflow, and this routing skill
pointing *at* it externally. Merged into one so the whole GitHub lifecycle (create → 
check status → resolve comments → finalize) lives in a single, consistently-named
place instead of being split across a naming exception.

## Routing table

| The owner asks... | Do this |
|---|---|
| "open a PR" / "create a PR" / "stwórz PR" / "zrób pull requesta" / "wystaw PR na githuba" | Follow "Create a PR" below |
| "what's next for this change" / "where are we" / "is this ready" | Read and follow `.claude/commands/nevo-ai/spec-status.md` (read-only) |
| "check the PR comments" / "what did Copilot say" (read-only) | Read and follow `.claude/commands/nevo-ai/spec-resolve-comments.md`, steps 1–4 only |
| "resolve the comments" / "fix what Copilot flagged" | Read and follow `.claude/commands/nevo-ai/spec-resolve-comments.md`, full flow |
| "merge this" / "finalize" / "close this out" | Read and follow `.claude/commands/nevo-ai/spec-finalize.md` |
| Any other cross-task audit ("are the examples good", "review the whole change for X") | Read and follow `.claude/commands/nevo-ai/spec-audit.md` |

Each `.claude/commands/nevo-ai/*.md` file is a complete, self-contained flow — read the
whole file, then follow it, the same as if the owner had typed the literal `/nevo-ai:*`
command. This skill does not duplicate their steps; it only exists to be found. "Create
a PR" is the one flow that lives directly in this file, since it isn't
change/task-scoped the way the others are (it works from the current branch, with only
best-effort spec/task detection).

## Create a PR

Draft a pull request for the current branch using this repo's own template
(`.github/pull_request_template.md`), then either send it to GitHub or just show the
draft — always by asking, never by assuming which one is wanted.

Read `.github/pull_request_template.md` fresh every run instead of hand-maintaining a
second copy of it here, so template edits are picked up automatically.

1. **Gather branch facts.** Get the current branch (`git branch --show-current`) and the
   base branch (try `git symbolic-ref refs/remotes/origin/HEAD`, strip
   `refs/remotes/origin/`; fall back to `main` if that fails). Get the commit log
   (`git log <base>..HEAD --oneline`) and diff shape (`git diff <base>...HEAD --stat`).
   If the current branch *is* the base branch, stop and say there is nothing to open a
   PR for — do not proceed.

2. **Best-effort related-artifact detection.** Treat this step's output as an inference
   to show the owner, not an asserted fact:
   - Strip a known prefix (`feature/`, `fix/`, `chore/`, `docs/`, ...) from the branch
     name to get a candidate slug. Check whether `specs/active/<slug>/change.yaml` (or
     `specs/archive/<slug>/change.yaml` — a change may already be archived even with its
     PR still open, see `docs/ai/workflow-overview.md`) exists.
   - If it exists: `Spec: specs/active/<slug>/` (or `specs/archive/<slug>/`). Resolve
     `Task:` — if the branch encodes a task id (per-task branch mode) or the change has
     exactly one non-terminal task in `change.yaml`, use that task's file; otherwise
     `n/a`. Read that task's `context.required`/`optional` list for any
     `docs/adr/ADR-*.md` entry to fill `ADR:`.
   - If no matching change directory exists: `Spec: none (Class S)`, `Task: n/a`,
     `ADR: none` — state plainly that this is because no matching `specs/active/` or
     `specs/archive/` directory was found, so the owner can correct it if it's wrong.

3. **Draft every section of the real template**, reading `.github/pull_request_template.md`
   for the exact section list and placeholder wording:
   - **Summary** — the *why*, not just the *what*, derived from the commit log and diff
     (same spirit as this project's own commit-message convention: summarize purpose,
     not a mechanical list of changed lines).
   - **Related artifacts** — from step 2.
   - **Changes** — a short bullet list derived from the diff.
   - **Verification** — never fabricate this. If build/test evidence isn't already
     visible earlier in the conversation, ask for it directly (e.g. "What did you run —
     `dotnet build`, `dotnet test`, `node tools/specs.mjs validate`, manual steps?")
     before writing anything in this section.
   - **Documentation impact** — check whether the diff touches `docs/architecture/` or
     `docs/development/`. If it doesn't, say so plainly rather than silently writing
     "none" without checking.
   - **Breaking changes** — infer from the diff (public API/contract changes visible in
     it). If genuinely uncertain, ask rather than guess. This section documents a
     decision that was already made earlier when the change was scoped (per
     `AGENTS.md`'s owner-approval table) — it does not re-open that decision here.
   - **Follow-ups** — ask; this cannot be inferred from a diff.

4. **Show the filled draft in the chat**, in full, before taking any git/GitHub action.
   This step alone is what satisfies "just show me the draft" — no tool call needed to
   produce it.

5. **Ask a closed menu — every run, regardless of how the request was phrased. Never
   proceed on assumption:**

   ```
   PR draft ready: `<branch>` → `<base>`.

   1. Push branch and create the PR on GitHub (gh pr create)
   2. Just show the draft — no git/GitHub action
   ```

6. **On answer 1:**
   - Check prerequisites first: is `gh` available (see "Rules" below — the PATH-fallback
     resolution, not just a bare `gh --version` in a fresh shell call) and authenticated
     (`gh auth status`). If unavailable/unauthenticated, say exactly that and stop —
     offer to fall back to option 2 instead of failing partway through.
   - If the branch has unpushed commits, push it: `git push -u origin <branch>` (a
     plain, non-force push — the menu answer just given is the explicit instruction that
     authorizes this one write, the same way a single confirmed menu choice authorizes
     its described action elsewhere in this repo's workflow commands).
   - Run `gh pr create --base <base> --head <branch> --title "<title>" --body-file
     <temp file containing the drafted body>`.
   - Report the PR URL exactly as `gh` returns it. On failure (e.g. a PR already exists
     for this branch), relay the CLI's exact error — do not retry, guess, or claim
     success.

   **On answer 2:** make no git or GitHub calls at all. The draft already shown in step
   4 is the deliverable; nothing further happens.

## Rules

- Never call `gh` directly for anything this file covers. If a request doesn't match
  any row above and isn't "create a PR" (e.g. inspecting an unrelated repo, a one-off
  `gh` question with no NEvo change involved), plain `gh` is fine — this skill only
  covers NEvo change/PR lifecycle operations.
- `gh` can be genuinely unavailable, or merely *appear* unavailable because it was
  installed after the current shell/session started and a running process doesn't pick
  up PATH changes made after it launched — a real, recurring case in this environment.
  `tools/lib/github.mjs`'s `resolveGhBinary()` already checks known install locations as
  a fallback before giving up; prefer routing through `node tools/specs.mjs
  status/finalize/comments` (which use that fallback) over a raw `gh --version` in a
  fresh Bash call, which won't see the fallback and may report "unavailable" when `gh`
  actually works.
- If `node tools/specs.mjs status <change-id>` reports the change isn't in
  `specs/active/`, it may already be in `specs/archive/` — `spec-status`,
  `spec-finalize`, and `spec-resolve-comments` all check both locations, so this is not
  a reason to fall back to `gh` by hand.
- Never run `git push` or `gh pr create` before the "Create a PR" step 5 menu has been
  answered. Never fabricate `Verification`, `Follow-ups`, or `Documentation impact`
  content — ask instead of assuming when evidence isn't already available. One action
  per run: never combine "show draft" and "create PR" silently, and never offer a
  third, unstated option. Do not amend existing commits or force-push as part of this
  flow.

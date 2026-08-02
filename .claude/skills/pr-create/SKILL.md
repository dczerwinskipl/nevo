---
name: pr-create
description: This skill should be used when the user asks to "create a PR", "open a pull request", "make a pull request", "stwórz PR", "zrób pull requesta", "wystaw PR na githuba", or otherwise wants a GitHub pull request opened or drafted for the current branch.
---

# Create a GitHub pull request

Draft a pull request for the current branch using this repo's own template
(`.github/pull_request_template.md`), then either send it to GitHub or just show the
draft — always by asking, never by assuming which one is wanted.

Read `.github/pull_request_template.md` fresh every run instead of hand-maintaining a
second copy of it here, so template edits are picked up automatically.

## Flow

1. **Gather branch facts.** Get the current branch (`git branch --show-current`) and the
   base branch (try `git symbolic-ref refs/remotes/origin/HEAD`, strip
   `refs/remotes/origin/`; fall back to `main` if that fails). Get the commit log
   (`git log <base>..HEAD --oneline`) and diff shape (`git diff <base>...HEAD --stat`).
   If the current branch *is* the base branch, stop and say there is nothing to open a
   PR for — do not proceed.

2. **Best-effort related-artifact detection.** Treat this step's output as an inference
   to show the owner, not an asserted fact:
   - Strip a known prefix (`feature/`, `fix/`, `chore/`, `docs/`, ...) from the branch
     name to get a candidate slug. Check whether `specs/active/<slug>/change.yaml`
     exists.
   - If it exists: `Spec: specs/active/<slug>/`. Resolve `Task:` — if the branch encodes
     a task id (per-task branch mode) or the change has exactly one non-`done` task in
     `change.yaml`, use that task's file; otherwise `n/a`. Read that task's
     `context.required`/`optional` list for any `docs/adr/ADR-*.md` entry to fill `ADR:`.
   - If no matching change directory exists: `Spec: none (Class S)`, `Task: n/a`,
     `ADR: none` — state plainly that this is because no matching `specs/active/`
     directory was found, so the owner can correct it if it's wrong.

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
   - Check prerequisites first: `gh --version` and `gh auth status`. If `gh` is missing
     or not authenticated, say exactly that and stop — offer to fall back to option 2
     instead of failing partway through.
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

- Never run `git push` or `gh pr create` before the step 5 menu has been answered.
- Never fabricate `Verification`, `Follow-ups`, or `Documentation impact` content — ask
  instead of assuming when evidence isn't already available.
- One action per run: never combine "show draft" and "create PR" silently, and never
  offer a third, unstated option.
- Do not amend existing commits or force-push as part of this flow.

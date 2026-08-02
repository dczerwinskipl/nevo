---
description: Read-only navigator — where a change currently sits across the whole spec → task → PR → merge chain, and the single next command. No memorizing the pipeline order.
argument-hint: <change-id>
disable-model-invocation: true
---

Arguments (`$ARGUMENTS`): `<change-id>`.

Every other `/nevo-ai:*` command's own "Next command" only knows its own step. This
command is the one place that looks at the whole chain — spec/task approval, git push
state, the PR, its review threads, verification — and says exactly one thing: here's
where you are, here's the one next action. It never performs that action itself.

## Flow

1. Run:

   ```
   node tools/specs.mjs status <change-id>
   ```

   This is entirely read-only. While any task is still non-terminal it reports purely
   from task status (fast, no git/GitHub calls at all). Once every task is terminal, it
   also gathers branch push state, the PR's state/draft flag/unresolved review-thread
   count (via `gh`, including bot reviewers like GitHub Copilot), and the same
   verification checks `/nevo-ai:spec-finalize` runs.

2. Report the result plainly: `stage`, `detail` (the one fact that produced it), and
   `nextCommand` — exactly as the JSON states them, never paraphrased into something
   more optimistic (same rule as every other verdict in this workflow: use the fixed
   value, don't invent a looser synonym).

3. Do not act on `nextCommand` from this command — even when it looks like a single,
   obvious next step (e.g. `needs-pr` → the `pr-create` skill). Naming it is this
   command's entire job; running it is a separate, explicit request.

## Ending the response

Use the closing shape from `SKILL.md` § "Ending every command's response". `Status` is
the `stage` value verbatim (`needs-approval` \| `ready-to-start` \| `in-progress` \|
`needs-pr` \| `pr-draft` \| `needs-comment-resolution` \| `needs-verification-fixes` \|
`ready-to-finalize` \| `done`). The facts line is `detail`. `Artifact` is `none` — this
command never writes anything. `Next command` is `nextCommand` verbatim — for stages
whose next action isn't a `/nevo-ai:*` command (`needs-pr`, `pr-draft`,
`needs-comment-resolution`, `needs-verification-fixes`), it is still exactly one
sentence naming the concrete action, not a vague pointer.

## Rules

- Read-only. Never writes a file, never changes a status, never opens a PR, never
  resolves a comment, never merges.
- Never claims a stage more advanced than `node tools/specs.mjs status` actually
  reported — if it says `needs-comment-resolution`, do not soften that to "almost ready."

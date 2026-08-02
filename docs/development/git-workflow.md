---
id: development.git-workflow
type: development
title: Git workflow
status: current
read_when:
  - creating a branch
  - preparing a pull request
  - using the specs CLI
  - starting a new task
summary: >
  Branch naming, PR strategy, merge model, and specs CLI integration for branch lifecycle.
related:
  - development.commit-conventions
  - development.pull-requests
---

# Git workflow

## Branch model

```
main
  ← pull request
  ← short-lived feature branch
```

No GitFlow. No long-lived release branches until a release strategy is formally specified.

## Branch naming

| Change class | Branch format |
|---|---|
| S — Small | Optional. Can commit directly to `main` at owner discretion. |
| T — Standard | `feature/<change-slug>` |
| A — Architectural (per-change mode) | `feature/<change-slug>` |
| A — Architectural (per-task mode) | `feature/<change-slug>/<task-id>` |
| E — Exploratory | `explore/<change-slug>` |

The branch mode (`per-change` or `per-task`) is declared in the change manifest (`change.yaml`).

## Branch lifecycle via specs CLI

```bash
node tools/specs.mjs approve <change> <task>       # marks task approved (ready for start)
node tools/specs.mjs start <change> <task>         # creates branch, sets task in-implementation
node tools/specs.mjs complete <change> <task>      # marks task implemented
node tools/specs.mjs verify <change> <task>        # marks task verified
node tools/specs.mjs archive <change>               # local-only: moves a fully terminal change to specs/archive/
node tools/specs.mjs finalize <change> [--check]    # gate on PR/review/verification state, then merge + archive
```

`start` refuses to run if the working tree has uncommitted changes.

`archive` only checks local task status — it has no idea whether the branch was ever
pushed, reviewed, or merged. `finalize` is the version that does: it gates on the
branch being fully pushed, an open (non-draft) PR existing with zero unresolved review
threads (any reviewer, including bot reviewers), and every verification command
passing, before it archives, commits, pushes, and merges. `--check` reports the gate
result with no side effects. See `docs/ai/specification-workflow.md` § "Finalizing: the
step after every task is verified" for the full gate and `.claude/commands/nevo-ai/
spec-finalize.md` for the Claude Code confirmation layer around it.

## Pull requests

All non-trivial changes go through a pull request. See `development/pull-requests.md`.

## Merge strategy

Squash merge into `main`. The PR title becomes the commit message — it must follow
Conventional Commits format (`development/commit-conventions.md`). `node tools/specs.mjs
finalize` performs exactly this (`gh pr merge --squash --delete-branch`) once its gate
passes and the owner has confirmed.

Do not rewrite local checkpoint commits on a feature branch. The squash handles cleanup.

## History

Commits before adoption of Conventional Commits (prior to this bootstrap) use plain
imperative titles. This is expected and acceptable. The convention applies from this
point forward.

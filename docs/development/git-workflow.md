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
node tools/specs.mjs approve <change> <task>  # marks task approved (ready for start)
node tools/specs.mjs start <change> <task>    # creates branch, sets task in-implementation
node tools/specs.mjs complete <change> <task> # marks task implemented
node tools/specs.mjs verify <change> <task>   # marks task verified
```

`start` refuses to run if the working tree has uncommitted changes.

## Pull requests

All non-trivial changes go through a pull request. See `development/pull-requests.md`.

## Merge strategy

Squash merge into `main`. The PR title becomes the commit message — it must follow
Conventional Commits format (`development/commit-conventions.md`).

Do not rewrite local checkpoint commits on a feature branch. The squash handles cleanup.

## History

Commits before adoption of Conventional Commits (prior to this bootstrap) use plain
imperative titles. This is expected and acceptable. The convention applies from this
point forward.

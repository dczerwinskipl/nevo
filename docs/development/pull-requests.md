---
id: development.pull-requests
type: development
title: Pull requests
status: current
read_when:
  - preparing a pull request
  - reviewing a pull request
summary: >
  PR format, required fields by change class, and review expectations.
related:
  - development.git-workflow
  - development.commit-conventions
---

# Pull requests

## Template

Use `.github/pull_request_template.md`. Fields required by change class:

| Field | Class S | Class T | Class A |
|---|---|---|---|
| Summary | Required | Required | Required |
| Related artifacts | Optional | Required | Required |
| Changes | Required | Required | Required |
| Verification | Optional | Required | Required |
| Documentation impact | Optional | Required | Required |
| Breaking changes | If applicable | If applicable | Required |
| Follow-ups | Optional | Optional | Recommended |

## Verification expectation

Before marking a task as verified, the PR must demonstrate:
- Build passes (`dotnet build`)
- Tests pass (`dotnet test`)
- Affected documentation updated
- No unrelated changes in the diff

## Review

Single-maintainer repository. No fake required approvals. Owner reviews their own PRs
as a final sanity check before merge.

For architectural changes: review the spec against the implementation before merging.
Specs must be updated in the same PR if the implementation deviates from the approved spec.

## Merge

Squash merge only. PR title must follow Conventional Commits format.
Delete the branch after merge.

`node tools/specs.mjs finalize <change>` performs the merge (and the archive that
should accompany it) once its gate passes: branch fully pushed, PR open and not a
draft, zero unresolved review threads (any reviewer, including bot reviewers), and
verification green. `--check` reports the gate without merging. See
`development/git-workflow.md` § "Branch lifecycle via specs CLI".

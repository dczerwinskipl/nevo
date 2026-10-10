---
id: task18-provenance-correction
status: draft
change: batch-execution-generalization
context:
  required:
    - specs/active/batch-execution-generalization/overview.md
    - specs/active/batch-execution-generalization/tasks/18-live-sweep-failure-path-completion.md
semantic_references:
  decisions: []
allowed_paths:
  - specs/active/batch-execution-generalization/change.yaml
forbidden_paths:
  - src/**
  - tools/**
depends_on: [live-sweep-failure-path-completion]
---

# Task: Correct task 18's own historically inaccurate tracking metadata

## Goal

Seventh-round corrective task from `overview.md` § "Seventh-round review correction".
A seventh review round found task 18's own `change.yaml` tracking metadata repeats
task 16's own earlier provenance mistake: task 18's own commit sequence was —

1. `ac9d3ed0` — created task 18's spec files **and** actually applied one of task 18's
   own literal acceptance criteria (the "superseded by tasks 17-18" dated note on
   `tasks/16-worktree-wide-pending-handover-sweep.md`), all before task 18's own
   approval.
2. `d9be4441` — task 18 approved.
3. `19a8c281` — the `routes.mjs`/test implementation landed.

Because the task-16 documentation edit landed in the pre-approval scaffolding commit
rather than the post-approval implementation commit, the automated approve/self-check
metadata capture recorded `baseline_revision`/`review_revision` spanning only
`d9be4441`→`19a8c281`, and `changed_paths` listing only `routes.mjs` and
`task-publish-transport.test.mjs` — omitting
`tasks/16-worktree-wide-pending-handover-sweep.md`, even though editing that file was
one of task 18's own stated acceptance criteria. This task corrects the metadata to
reflect reality, exactly as task 17 did for task 16's own equivalent mistake.

## Requirements

- Correct `change.yaml`'s `live-sweep-failure-path-completion` (task 18) entry:
  - Set `implementation.baseline_revision` to the commit immediately preceding
    `ac9d3ed0` (the state of the repo before any of task 18's own changes began).
  - Add `specs/active/batch-execution-generalization/tasks/16-worktree-wide-pending-handover-sweep.md`
    to `implementation.changed_paths`.
  - Leave `implementation.review_revision` and `self_check.revision` as they are
    (`19a8c281`, the final commit containing the full set of task 18 changes) — the
    span from the corrected baseline to this revision already covers both commits.
  - Add a dated `provenance_correction` note on the same block, matching the style
    already used on task 16's own entry, explaining what happened.
- Do not rewrite git history. Do not change task 18's own recorded `status`,
  self-check pass/fail result, or verification outcome.

## Implementation constraints

- This task touches only `change.yaml`. No code, no test files, no other task's own
  `.md` file.
- This task's own correction must be committed and pushed only after its own
  `approve`/`start` transitions land — matching the ordering discipline tasks 17 and
  18 themselves established in response to their own provenance findings.

## Acceptance criteria

- `change.yaml`'s task 18 entry carries a corrected `baseline_revision` (the commit
  before `ac9d3ed0`), a `changed_paths` list that includes
  `tasks/16-worktree-wide-pending-handover-sweep.md`, and a dated
  `provenance_correction` note.
  `inspection: change.yaml's live-sweep-failure-path-completion entry reflects the real changed paths and baseline`
- Task 18's own recorded `status`, self-check result, and verification outcome are
  unchanged.
  `inspection: task 18's status, self_check, and verification fields are untouched by this correction`
- `node tools/specs.mjs validate` still passes.
  `automated: node tools/specs.mjs validate`

## Verification

```bash
node tools/specs.mjs validate
```

## Out of scope

Any code change. Any change to task 18's own `.md` file or its recorded verification
history.

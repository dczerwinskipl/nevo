---
id: definition-session-choice-schema
status: draft
change: session-continuity-choice
context:
  required:
    - specs/active/session-continuity-choice/overview.md
    - specs/active/session-continuity-choice/owner-decisions.md
    - tools/specs/workflow/definitions/schema.mjs
    - tools/specs/workflow/resolve-incoming-execution.mjs
    - .nevo-ai/workflows/standard-v1.yaml
allowed_paths:
  - tools/specs/workflow/definitions/schema.mjs
  - tools/specs/workflow/resolve-incoming-execution.mjs
  - .nevo-ai/workflows/standard-v1.yaml
  - tools/tests/workflow-definition-session-choice.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
semantic_references:
  decisions: [D1, D2, D4]
---

# Task: Definition session-choice schema

## Goal

Let a workflow transition declare which session policies the owner may choose and which
prior step's session is the reuse candidate, without changing any definition that does not
use the new fields.

## Requirements

- In `transition.execution`, accept optional:
  - `allow`: a non-empty array of known session policies (`fresh`, `reuse`) that must
    include the declared `session`; absent means "only the declared `session`".
  - `reuseFrom`: the id of a step that exists in the definition; only valid when `reuse`
    is declared or allowed.
- Validate both with the same style of messages as the existing `execution.*` checks
  (`schema.mjs`), and carry them through definition normalization.
- `resolveIncomingExecution` additionally returns `allow` (normalized, default
  `[session]`) and `reuseFrom` (or `null`).
- Annotate `.nevo-ai/workflows/standard-v1.yaml` (D2, D4):
  - `human-verification → implementation` (fail): `session: reuse`, `reuseFrom:
    implementation`, `allow: [reuse, fresh]`, role unchanged.
  - `implementation → review`: `session: fresh`, `allow: [fresh, reuse]`, `reuseFrom:
    implementation`.
  - `review → implementation` (fail): unchanged unless the owner resolves the open
    question in `overview.md`.
- Do not change `.nevo-ai/workflows/standard.yaml` or the template under
  `tools/specs/workflow/templates/`.

## Acceptance criteria

- A definition without `allow`/`reuseFrom` validates and normalizes identically to before.
  `automated: node --test tools/tests/workflow-definition-session-choice.test.mjs`
- Unknown policies in `allow`, an `allow` missing the declared `session`, an empty
  `allow`, and a `reuseFrom` naming a nonexistent step are each rejected with a
  specific message.
  `automated: node --test tools/tests/workflow-definition-session-choice.test.mjs`
- `resolveIncomingExecution` returns the new fields for annotated transitions and the
  defaults for others.
  `automated: node --test tools/tests/workflow-definition-session-choice.test.mjs`
- The shipped `standard-v1.yaml` loads and validates.
  `automated: node --test tools/tests/workflow-definitions.test.mjs`

## Verification

```bash
node --test tools/tests/workflow-definition-session-choice.test.mjs
node --test tools/tests/workflow-definitions.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Server-side use of the fields (task 02) and any UI.

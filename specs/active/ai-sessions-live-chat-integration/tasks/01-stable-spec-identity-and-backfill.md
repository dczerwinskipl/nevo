---
id: ai-sessions-live-chat-integration.stable-spec-identity-and-backfill
status: draft
change: ai-sessions-live-chat-integration
context:
  required:
    - specs/active/ai-sessions-live-chat-integration/overview.md
    - specs/active/ai-sessions-live-chat-integration/areas/stable-spec-identity.md
    - specs/active/ai-sessions-live-chat-integration/owner-decisions.md
    - tools/specs/service.mjs
    - tools/specs/validation.mjs
    - tools/specs.mjs
    - tools/dashboard/server/data.mjs
    - tools/dashboard/tests/data.test.mjs
    - .claude/commands/nevo-ai/spec-create.md
  optional:
    - docs/ai/specification-workflow.md
    - docs/ai/how-to-navigate.md
allowed_paths:
  - tools/specs.mjs
  - tools/specs/**
  - tools/tests/**
  - tools/dashboard/server/data.mjs
  - tools/dashboard/tests/data.test.mjs
  - .claude/commands/nevo-ai/spec-create.md
  - .claude/skills/nevo-ai-spec-workflow/templates/**
  - docs/ai/specification-workflow.md
  - docs/ai/how-to-navigate.md
  - specs/active/*/change.yaml
  - specs/archive/*/change.yaml
  - specs/index.generated.json
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2]
  constraints: [C1, C2, C3]
---

# Task: Stable specification identity and backfill

## Goal

Introduce additive immutable `spec_id`, generate it for future specifications, backfill every current manifest exactly once, and expose the stable identity without breaking slug-based workflows.

## Implementation constraints

- Use a canonical random UUID representation and the Node standard library; do not add a dependency.
- Keep current `id`, directory slug, selectors, branch naming, and URLs compatible.
- Validate `spec_id` format and global uniqueness across active and archive.
- Add an explicit idempotent backfill command/service; never rewrite an existing valid ID.
- Backfill current manifests, including this change, as a visible reviewable migration.
- Update spec-create guidance/templates so every future spec writes the ID at creation.
- Legacy reads may omit `spec_id`; stable-relation operations must return an actionable migration-needed error rather than use slug.

## Acceptance criteria

1. Validation accepts a legacy missing ID during the compatibility window but rejects malformed or duplicate `spec_id` values with precise paths. `automated: node --test tools/tests/spec-identity.test.mjs`
2. Every new spec-created manifest receives one UUID and repeated creation/backfill logic cannot replace it. `automated: node --test tools/tests/spec-identity.test.mjs`
3. Backfill assigns unique IDs to all current active/archive manifests and a second run makes no file changes. `automated: node --test tools/tests/spec-identity.test.mjs`
4. Context packets, generated indexes, and dashboard-consumable change projections can carry both `specId` and slug. `automated: node --test tools/tests/spec-identity.test.mjs tools/tests/index-generation.test.mjs`
5. Renaming a fixture directory while retaining its manifest leaves the exposed stable identity unchanged. `automated: node --test tools/tests/spec-identity.test.mjs`
6. Existing spec CLI regression tests remain green. `automated: node --test tools/tests/*.test.mjs`

## Verification

```text
node --test tools/tests/spec-identity.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
```

## Documentation impact

Update spec workflow/guidance and generated spec indexes. Do not document AI session behavior yet.

## Out of scope

- Slug rename automation.
- Removing or redefining current manifest `id`.
- Session/provider implementation.

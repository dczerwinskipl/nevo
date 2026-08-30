---
id: ai-session-issues-and-diagnostics.canonical-cutover-and-cleanup
status: draft
change: ai-session-issues-and-diagnostics
context:
  required:
    - specs/active/ai-session-issues-and-diagnostics/overview.md
    - specs/active/ai-session-issues-and-diagnostics/owner-decisions.md
    - specs/active/ai-session-issues-and-diagnostics/areas/chat-migration-and-validation.md
    - specs/active/ai-session-issues-and-diagnostics/areas/persistence-and-server-projection.md
    - docs/development/node-tooling-guidelines.md
    - docs/development/react-component-guidelines.md
    - docs/development/ai-sessions.md
    - docs/decisions/ADR-0007-ai-session-provider-adapters.md
  optional:
    - specs/active/ai-session-issues-and-diagnostics/discovery.md
allowed_paths:
  - tools/dashboard/server/ai/**
  - tools/dashboard/ui/features/agent-sessions/**
  - tools/dashboard/tests/**
  - docs/development/ai-sessions.md
  - docs/decisions/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2, D3, D4, D11, D12, D13, D14]
  constraints: [C1, C2, C3, C4, C5, C6, C15, C16, C17, C18]
  dependency_contracts: [cross-provider-lifecycle-validation]
---

# Task: Cut over to the canonical chat and remove migration scaffolding

## Goal

Make the semantic model/projection/chat canonical and delete every V1/compatibility/migration-only
path, leaving unversioned production names and updated architecture documentation.

## Requirements

- Remove V1 chat projection and renderer, temporary representation discriminator/switch/state, and
  any V1-specific fallback path.
- Remove transitional adapter callback bridge, compatibility persistence/event mappings, obsolete
  current message/tool projection types, and dead provider mappings.
- Remove migration-only tests while retaining canonical lifecycle, provider, projection, and UX
  regression coverage.
- Rename surviving V2 types/modules/routes/components to unversioned canonical names.
- Update `docs/development/ai-sessions.md`, add a new ADR for the implemented architecture, and mark
  ADR-0007 superseded only where the new decision replaces it. Do not rewrite ADR history.
- Search relevant production code case-insensitively for `v1`, `v2`, `legacy`, `compat`, `oldChat`,
  and `newChat`; review every match and remove migration scaffolding. Retain legitimate unrelated
  protocol/version strings only with an explicit verification note.
- Verify exactly one provider-neutral Turn model, one server chat projection, and one chat
  implementation remain.

## Acceptance criteria

1. No V1 projection/UI/switch/discriminator, transitional callback bridge, duplicate persistence
   projection, or migration-only provider mapping remains. `inspection: production dependency review`
2. Canonical production symbols are unversioned; no surviving `*V2` Turn/chat/projection/model names
   remain. `inspection: scoped symbol search`
3. The required migration-term search is recorded with each retained match classified as legitimate
   unrelated versioning; all migration matches are removed. `inspection: reviewed search output`
4. Browser code has no provider/shell interpretation and server exposes one semantic projection.
   `automated: npm --prefix tools/dashboard test`
5. Canonical cross-provider ordering, compound tools, waits, attention, cancellation, reload, and
   FinalAnswer scenarios remain green after cleanup. `automated: npm --prefix tools/dashboard test`
6. Architecture documentation and ADR state describe the implemented unversioned architecture.
   `automated: node tools/docs.mjs validate`
7. Full dashboard/spec/docs quality gates pass. `automated: npm --prefix tools/dashboard test && npm --prefix tools/dashboard run build && node tools/specs.mjs validate && node tools/specs.mjs check && node tools/docs.mjs validate && node tools/docs.mjs check`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
node tools/specs.mjs check
node tools/docs.mjs validate
node tools/docs.mjs check
```

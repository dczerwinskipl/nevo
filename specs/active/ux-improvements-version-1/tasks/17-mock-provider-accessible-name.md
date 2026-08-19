---
id: ux-improvements-version-1.mock-provider-accessible-name
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/accessibility-and-touch-targets.md
    - .nevo-ai-local/ux-review/report/05-accessibility-and-touch-targets.md
    - tools/dashboard/src/components/ai-session-create-modal.tsx
  optional:
    - .nevo-ai-local/ux-review/screenshots/04-new-session-mock-and-slug-hierarchy.png
allowed_paths:
  - tools/dashboard/src/components/ai-session-create-modal.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Fix broken accessible name on provider buttons (A11Y-1)

## Goal

The "mock" provider button's computed accessible name is
`"Provider Claude Claude Code Antigravity Antigravity / Gemini"` instead of its own content
(`"mock, Mock AI"`) — it absorbs the group legend ("Provider") and sibling buttons' text
because there's no explicit `aria-label`. Add an explicit `aria-label` per provider button
(`ai-session-create-modal.tsx:131-156`, the `enabledProviders.map(...)` button), e.g.
`"Provider: Mock AI"`.

## Implementation constraints

- Apply the `aria-label` to every provider button, not just `mock` — the same
  group/sibling-context name-absorption risk applies to all of them, even if only `mock` was
  observed broken.
- Use each provider's own `label`/`id` fields (already available in the `.map()` callback) to
  build the `aria-label` — no new data needed.

## Acceptance criteria

1. Every provider button's computed accessible name matches its own provider (e.g. "Provider:
   Mock AI" for `mock`), verified via the accessibility tree — not the group legend or
   sibling buttons' text. `inspection: read the accessibility tree for each provider button`
2. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Provider ordering/default selection — see `mock-provider-config-order` (task 05).

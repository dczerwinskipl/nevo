---
id: ux-improvements-version-1.mock-provider-config-order
status: verified
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/owner-decisions.md
    - specs/active/ux-improvements-version-1/areas/chat-and-sessions.md
    - tools/dashboard/src/components/ai-session-create-modal.tsx
    - tools/dashboard/server/ai-services.mjs
  optional:
    - tools/ai/registry.mjs
allowed_paths:
  - tools/dashboard/src/components/ai-session-create-modal.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Follow server config order for provider list, no frontend override (CHAT-6, D2)

## Goal

Per owner decision D2 (`owner-decisions.md`): remove the frontend's own hardcoded mock-last
sort in `ai-session-create-modal.tsx:22-26` and render providers in exactly the order
`service.listProviders()` already returns — which is the registration order set once in
`tools/dashboard/server/ai-services.mjs:28`
(`createAiAdapterRegistry([claudeAdapter, antigravityAdapter, mockAdapter])`), already mock-last.
`tools/dashboard/server/ai-services.mjs` is context only — this task changes no server file.

## Implementation constraints

- Delete the `.sort((a, b) => { if (a.id === 'mock') return 1; if (b.id === 'mock') return -1; return 0; })`
  call on `enabledProviders` (lines 22-26); use `providers.data?.providers.filter((p) => p.enabled) ?? []`
  directly.
- Do not add a dev/env flag to hide `mock` — D2 explicitly rejected that option.
- Do not touch `tools/dashboard/server/ai-services.mjs` or `tools/ai/registry.mjs` — the
  server order is already correct; this is a frontend-only fix.
- The default-selection `useEffect` (lines 36-56, `availableProviders[0]` /
  `enabledProviders[0]`) needs no code change — it already selects the first entry of whatever
  order it's given, so removing the duplicate sort is sufficient.

## Acceptance criteria

1. `ai-session-create-modal.tsx` contains no provider-ordering logic of its own; the rendered
   tile order matches `providers.data.providers`' order exactly. `inspection: read the file, confirm no .sort()/comparator remains on the providers list`
2. With the current server config (`[claudeAdapter, antigravityAdapter, mockAdapter]`), opening
   "New session AI" still shows mock last and does not pre-select it by default (Claude
   selected by default when available). `inspection: open the modal, verify default selection and tile order`
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Any change to provider registration order itself (`ai-services.mjs`) — that's a config change
an operator makes directly, not something this task hardcodes a rule for.

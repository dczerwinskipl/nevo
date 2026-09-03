---
id: semantic-color-tokens-with-tailwind-css-4.agent-sessions-and-work
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/agent-sessions-and-work.md
    - tools/dashboard/ui/index.css
    - tools/dashboard/ui/shared/status-tone.ts
allowed_paths:
  - tools/dashboard/ui/features/agent-sessions/**
forbidden_paths:
  - tools/dashboard/ui/index.css
  - tools/dashboard/ui/components/ui/**
  - tools/dashboard/ui/shared/**
  - tools/dashboard/ui/features/specifications/**
  - tools/dashboard/ui/features/pull-requests/**
  - tools/dashboard/ui/features/operations/**
  - src/**
depends_on:
  - shared-ui-primitives
  - status-tone-contract
semantic_references:
  decisions: [D2, D3]
  constraints: [C5]
---

# Task: Migrate agent-sessions feature and Work V2 to semantic utilities

## Goal

Migrate every component under `tools/dashboard/ui/features/agent-sessions/**` from
`-[var(--…)]`/raw-white-black/`color-mix(...)` usage to semantic Tailwind utilities and
the central status-tone module, fix the 4-site `--foreground-muted` dangling reference,
and rename `ProviderBadge`'s `cat-1`/`cat-2` usage to `provider-claude`/
`provider-antigravity`.

## Dependencies

`shared-ui-primitives`, `status-tone-contract`.

## Implementation constraints

- Sweep the entire `features/agent-sessions/**` directory — do not limit changes to the
  specific files/lines cited in `areas/agent-sessions-and-work.md`; those are confirmed
  examples, not an exhaustive list.
- Collapse both duplicated `color-mix(...)` recipes (accent-8%-selected-pill at
  `create-agent-session-dialog.tsx:153,189` and `interaction-prompt.tsx:99,139`;
  warning-strong-80/90%-muted-text at `create-agent-session-dialog.tsx:262` and
  `provider-unavailable-banner.tsx:18`) into opacity-modifier utilities.
- `work-indicator-v2.tsx`/`turn-work-summary.tsx`: touch only their non-severity
  `-[var(--…)]` usages (e.g. `--foreground-muted`) — their severity-mapping logic
  already changed in `status-tone-contract`; do not re-touch or re-derive it here.
- `ProviderBadge`: rename token consumption only — Claude/Antigravity colors stay
  numerically identical (`#fb923c`/`#60a5fa`), this is a naming fix, not a repaint.
- Verify each of the 4 `--foreground-muted` sites renders sensibly now that the
  reference actually resolves (it was previously a silent no-op) — this may be the
  first time text becomes visible there; confirm it's an intended, legible state.

## Acceptance criteria

1. Zero `-[var(--` occurrences remain under `features/agent-sessions/**`.
   `automated: ! grep -rq -- "-\[var(--" tools/dashboard/ui/features/agent-sessions`
2. Zero raw `bg/text/border-white|black` occurrences remain under
   `features/agent-sessions/**`.
   `automated: ! grep -rqE "bg-(white|black)|text-(white|black)|border-(white|black)" tools/dashboard/ui/features/agent-sessions`
3. Zero `color-mix(...)` occurrences remain under `features/agent-sessions/**`.
   `automated: ! grep -rq "color-mix" tools/dashboard/ui/features/agent-sessions`
4. `--foreground-muted` does not appear anywhere in the repository.
   `automated: ! grep -rq -- "--foreground-muted" tools/dashboard`
5. `cat-1`/`cat-2` do not appear anywhere under `features/agent-sessions/**`.
   `automated: ! grep -rqE "cat-1|cat-2" tools/dashboard/ui/features/agent-sessions`
6. `npm --prefix tools/dashboard test`, `npm --prefix tools/dashboard run build`, and
   `npm --prefix tools/dashboard run test:storybook` pass.
   `automated: each command`
7. Chat/agent-session Storybook stories show no unintended visual change versus the
   pre-task baseline, except the `--foreground-muted` fix becoming visible where it was
   previously a silent no-op — recorded via screenshot comparison.
   `inspection: before/after screenshot comparison performed and recorded`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard run test:storybook
```

## Documentation impact

None yet — `tasks/06-storybook-and-documentation.md`.

## Out of scope

- `work-indicator-v2.tsx`/`turn-work-summary.tsx` severity-mapping logic —
  `tasks/03-status-tone-contract.md` (already done by the time this task runs).
- `features/specifications/**`, `features/pull-requests/**`, `features/operations/**` —
  `tasks/05-specs-lanes-and-remaining-ui.md`.

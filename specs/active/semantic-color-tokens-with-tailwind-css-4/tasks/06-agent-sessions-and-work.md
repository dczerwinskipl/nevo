---
id: semantic-color-tokens-with-tailwind-css-4.agent-sessions-and-work
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/agent-sessions-and-work.md
    - docs/development/react-component-guidelines.md
    - docs/development/ui-ux-guidelines.md
    - docs/development/nevo-ai-ux-guidelines.md
    - docs/development/nevo-interaction-model.md
    - docs/development/storybook.md
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
  decisions: [D2, D3, D8, D9]
  constraints: [C5, C7, C8]
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
- `work-indicator-v2.tsx`/`pending-interaction-view-v2.tsx`/
  `turn-work/turn-work-summary.tsx` (**path correction**: `turn-work-summary.tsx` lives
  under a sibling `turn-work/` directory, not `work-v2/`): touch only their
  non-severity/non-attention `-[var(--…)]` usages (e.g. `--foreground-muted`, icon
  colors) — their severity/attention-mapping logic already changed in
  `status-tone-contract`; do not re-touch or re-derive it here.
- `ProviderBadge`: rename token consumption only — Claude/Antigravity colors stay
  numerically identical (`#fb923c`/`#60a5fa`), this is a naming fix, not a repaint.
- Verify each of the 4 `--foreground-muted` sites renders sensibly now that the
  reference actually resolves (it was previously a silent no-op) — this may be the
  first time text becomes visible there; confirm it's an intended, legible state.
- `create-agent-session-dialog.tsx:151-157,187-191`: convert the ternary expressions
  that select whole pre-written class strings into `cn()`-based conditional
  composition, per the class-composition contract (D8) — do not leave raw
  string-literal ternaries as the composition mechanism.
- **Destructive-action migration (item 5 audit):** `agent-session-details.tsx:120-144`'s
  "Usuń sesję z dysku" (delete session) button is a confirmed real, irreversible
  destructive action — migrate it from `variant="ghost"` plus ~7 manual `--danger*`
  class overrides to `<Button variant="destructive">` (added in `tasks/04-*`), removing
  the manual overrides entirely. Per the Task 04 implementation finding on nested
  contrast, the surrounding container (`agent-session-details.tsx:124`) migrates to a
  neutral dark surface with a destructive border (`border border-action-destructive/30 bg-surface`),
  rather than retaining a red-tinted fill (`bg-[var(--danger-muted)]` / `bg-action-destructive/10`)
  which would compound background luminance and cause `text-action-destructive` to fail
  the ≥4.5:1 contrast requirement. `composer/agent-session-composer.tsx:159-173`'s
  "Przerwij" (stop/cancel active turn) button is a **different, non-destructive** action
  — migrate its raw `--danger*` `var()` usage to semantic status tokens, but keep it
  visually lighter than the delete button and do **not** apply
  `variant="destructive"` to it; the two must not share the same visual contract.
- Apply the "required inspection when touching a component" checklist
  (`react-component-guidelines.md` §11/§12) to every component this task changes.

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
7. Durable Storybook tests for chat/agent-session components pass. The
   `--foreground-muted` fix becoming visible (previously a silent no-op) is an
   intentional, expected change (D9), reviewed for legibility — not required to be
   pixel-identical to the pre-task baseline.
   `inspection: reviewed for legibility and recorded`
8. `create-agent-session-dialog.tsx`'s two ternary-based class selections use `cn()`.
   `inspection: source reviewed`
9. `agent-session-details.tsx`'s delete-session button uses `variant="destructive"`
   with zero manual `--danger*` overrides remaining.
   `automated: ! grep -q -- "danger" tools/dashboard/ui/features/agent-sessions/agent-session-details.tsx`
10. `agent-session-composer.tsx`'s stop/cancel button uses semantic status tokens, does
    not use `variant="destructive"`, and remains visually distinguishable (lighter)
    from the delete button.
    `inspection: source and rendered comparison reviewed`
11. The "required inspection when touching a component" checklist was applied.
    `inspection: checklist applied and recorded per component`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
npm --prefix tools/dashboard run test:storybook
```

## Documentation impact

None yet — `tasks/08-storybook-and-documentation.md`.

## Out of scope

- `work-indicator-v2.tsx`/`pending-interaction-view-v2.tsx`/
  `turn-work/turn-work-summary.tsx` severity/attention-mapping logic —
  `tasks/05-status-tone-contract.md` (already done by the time this task runs).
- `features/specifications/**`, `features/pull-requests/**`, `features/operations/**` —
  `tasks/07-specs-lanes-and-remaining-ui.md`.

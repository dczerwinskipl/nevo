---
id: semantic-color-tokens-with-tailwind-css-4.react-class-composition-guidelines
status: draft
change: semantic-color-tokens-with-tailwind-css-4
context:
  required:
    - specs/active/semantic-color-tokens-with-tailwind-css-4/overview.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/owner-decisions.md
    - specs/active/semantic-color-tokens-with-tailwind-css-4/areas/react-class-composition-guidelines.md
    - docs/development/react-component-guidelines.md
    - docs/ai/task-routing.md
    - tools/dashboard/ui/lib/utils.ts
    - tools/dashboard/ui/components/ui/button.tsx
    - tools/dashboard/ui/components/ui/sheet.tsx
    - tools/dashboard/ui/components/ui/status-card.tsx
  optional:
    - tools/dashboard/ui/shared/ui/status-label.tsx
    - tools/dashboard/ui/features/agent-sessions/transcript/projection.ts
    - tools/dashboard/ui/features/pull-requests/changes/status.ts
allowed_paths:
  - docs/development/react-component-guidelines.md
  - docs/ai/task-routing.md
  - docs/index.generated.json
  - docs/index.generated.md
  - docs/routing.generated.json
forbidden_paths:
  - docs/development/ui-ux-guidelines.md
  - docs/development/nevo-ai-ux-guidelines.md
  - docs/development/nevo-interaction-model.md
  - tools/dashboard/ui/**
  - src/**
semantic_references:
  decisions: [D8]
  constraints: [C8]
---

# Task: Document the Tailwind class-composition contract

## Goal

Extend `docs/development/react-component-guidelines.md` with the durable Tailwind
class-composition rules (local layout, `cva()` variants, domain-state → tone → variant →
utility → token, native DOM/ARIA state, `cn()` discipline, banned interpolated classes,
multi-slot recipes, `@apply` scope, required-inspection checklist) and update
`docs/ai/task-routing.md`'s existing frontend routing invariants to name the new
contract — no component code changes.

## Dependencies

None.

## Implementation constraints

- Write the new section using the change request's own rule text as the normative
  content (see `areas/react-class-composition-guidelines.md` § Requirements for the full
  breakdown) — do not paraphrase away the specific banned/required patterns.
- Reproduce the `StatusTone` union type exactly:
  ```ts
  type StatusTone =
    | 'neutral'
    | 'active'
    | 'success'
    | 'warning'
    | 'error'
    | 'attention'
    | 'info';
  ```
- Merge the "required inspection when touching a component" list into §11's existing
  review checklist as additional items — do not create a second, competing checklist.
- `task-routing.md`: edit only the "Invariants to preserve" bullets under "Developing
  React UI and Dashboard frontend" (`task-routing.md:113-116`) — the `RT-16` routing
  table row already covers `tools/dashboard/ui/**` and needs no change.
- Do not touch `ui-ux-guidelines.md`, `nevo-ai-ux-guidelines.md`, or
  `nevo-interaction-model.md` — their existing status/tone content is product-level, not
  React-implementation-level, and doesn't change.
- No `tools/dashboard/ui/**` file may be touched by this task.

## Acceptance criteria

1. `react-component-guidelines.md` contains all 8 class-composition subsections named in
   `areas/react-class-composition-guidelines.md`, including the exact `StatusTone` type.
   `inspection: document reviewed section-by-section against the required list`
2. §11's review checklist includes the required-inspection items without duplicating the
   narrative subsection's content verbatim as a second list with different wording.
3. `task-routing.md`'s frontend invariants name the new contract; `RT-16` is unchanged.
4. `node tools/docs.mjs validate` passes. `automated: node tools/docs.mjs validate`
5. `node tools/docs.mjs check` passes. `automated: node tools/docs.mjs check`
6. No file outside `docs/development/react-component-guidelines.md`,
   `docs/ai/task-routing.md`, and the generated doc indexes was modified.
   `inspection: diff reviewed`

## Verification

```text
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Documentation impact

This task's entire output is documentation.

## Out of scope

- Any component migration — `tasks/04`, `05`, `06`, `07` apply these rules while doing
  their own already-scoped work.
- `ui-ux-guidelines.md`, `nevo-ai-ux-guidelines.md`, `nevo-interaction-model.md`.

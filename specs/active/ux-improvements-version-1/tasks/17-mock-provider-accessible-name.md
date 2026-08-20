---
id: ux-improvements-version-1.mock-provider-accessible-name
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/accessibility-and-touch-targets.md
    - tools/dashboard/src/components/ai-session-create-modal.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/ai-session-create-modal.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Fix provider-selection group accessibility semantics (A11Y-1)

## Goal

The "mock" provider button's computed accessible name is
`"Provider Claude Claude Code Antigravity Antigravity / Gemini"` instead of its own content
(`"mock, Mock AI"`) — it absorbs the group legend text and its sibling buttons' text. Root
cause, confirmed in the markup: the entire provider selection — the "Provider" legend text
*and* the whole grid of provider `<button>`s — is nested inside a single `<label>` element
(`ai-session-create-modal.tsx:124-159`: `<label className="mt-6 block text-xs
font-semibold">Provider<div className="mt-2 grid ...">{enabledProviders.map(p => <button
...>)}</div></label>`). A `<label>` is only valid associated with exactly one form control;
wrapping a whole group of buttons in one is what produces the browser's garbled name
computation. The fix is a structural one, not just an added attribute.

## Implementation constraints

Do not just add an `aria-label` to the broken button and call it fixed — restructure the
control so the whole group is semantically correct. The resulting markup must provide:

- **A group name**: the provider-selection control as a whole has an accessible group name
  ("Provider"), exposed via a real grouping semantic (`<fieldset>`+`<legend>`, or
  `role="group"`/`role="radiogroup"` with `aria-label`/`aria-labelledby`) — not a `<label>`
  wrapping more than one control.
- **A per-option accessible name**: each provider button's computed accessible name reflects
  only its own provider (e.g. "Mock AI"), never the group legend or sibling buttons' text.
- **A represented selected state**: which provider is currently selected is exposed
  programmatically, not only visually (border/ring styling) — e.g. `aria-pressed` per button
  if kept as independent toggle buttons, or `role="radio"`/`aria-checked` per button if
  switched to radiogroup semantics (selection here is mutually exclusive — exactly one
  provider active at a time — so radiogroup semantics are also a legitimate fit, not just
  toggle-button semantics).
- **Correct keyboard handling**: if the buttons remain plain `<button>` elements (toggle-button
  semantics), native Tab-to-focus / Enter-or-Space-to-activate already satisfies this — no
  extra work needed. If instead switched to `role="radiogroup"`/`role="radio"` semantics,
  standard roving-tabindex arrow-key navigation between options must be implemented — ARIA
  radio semantics without arrow-key support is an incomplete, non-conformant pattern; do not
  ship `role="radio"` without it.
- **No `<label>` misuse**: no `<label>` element wraps more than one interactive control
  anywhere in this control.

Several concrete HTML structures satisfy the above (a `<fieldset>`+`<legend>` wrapping plain
toggle buttons with `aria-pressed`, or a `role="radiogroup"` wrapping `role="radio"` elements
with roving tabindex, are both acceptable) — pick whichever fits the existing component
structure with the least disruption; the acceptance criteria below test the semantics, not one
specific markup.

## Acceptance criteria

1. The provider-selection control exposes one accessible group name ("Provider"), read via the
   accessibility tree — not via a `<label>` wrapping multiple controls.
   `inspection: read the accessibility tree for the group container`
2. Every provider button's computed accessible name matches only its own provider — verified
   via the accessibility tree, not the group legend or sibling buttons' text.
   `inspection: read the accessibility tree for each provider button individually`
3. The currently selected provider is exposed programmatically (`aria-pressed`, `aria-checked`,
   or equivalent depending on the semantics chosen), consistent across all provider buttons.
   `inspection: select each provider in turn, confirm the programmatic selected-state attribute updates accordingly`
4. Keyboard-only interaction can both move focus between providers and select one, using
   whichever key pattern is correct for the semantics chosen (Tab+Enter/Space for toggle
   buttons; Tab-in then arrow keys+Enter/Space for a radiogroup).
   `inspection: navigate and select using only the keyboard`
5. No `<label>` element in this component wraps more than one interactive control.
   `inspection: read the markup`
6. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Provider ordering/default selection — see `mock-provider-config-order` (task 05).

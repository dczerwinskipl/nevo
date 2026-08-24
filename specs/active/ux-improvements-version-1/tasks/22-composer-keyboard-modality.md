---
id: ux-improvements-version-1.composer-keyboard-modality
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/owner-decisions.md
    - tools/dashboard/src/components/composer/composer.tsx
    - tools/dashboard/src/components/composer/composer-sizing.ts
    - tools/dashboard/tests/composer-interaction.test.mjs
  optional: []
allowed_paths:
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
  - tools/dashboard/src/components/composer/composer.tsx
  - tools/dashboard/src/components/composer/composer-sizing.ts
  - tools/dashboard/tests/composer-interaction.test.mjs
  - specs/active/ux-improvements-version-1/owner-decisions.md
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Composer keyboard interaction modality (D7)

## Goal

Per Owner Decision D7, configure chat composer keyboard interaction based on input modality (`usehooks-ts` `useMediaQuery`) rather than screen size heuristics or user-agent sniffing.

Desktop / keyboard-oriented interaction:
- `Enter` sends the message;
- `Shift + Enter` inserts a newline.

Touch-oriented interaction:
- `Enter` inserts a newline;
- Send button sends explicitly.

IME composition:
- `Enter` during active IME composition never sends in either modality.

## Implementation constraints

- Install and use `usehooks-ts` `useMediaQuery('(pointer: coarse) and (hover: none)')`.
- Do not use UA/device-detection libraries (`react-device-detect`, `mobile-detect`, `ua-parser-js`).
- Do not use `window.innerWidth`, `ontouchstart`, or `navigator.maxTouchPoints`.
- Name abstractions after interaction intent (`prefersTouchInteraction`, `enterToSend`, `useComposerInputMode`), not device classification.

## Acceptance criteria

1. When `prefersTouchInteraction === false` (fine pointer + hover / desktop), `Enter` sends message and `Shift + Enter` inserts newline. `automated: npm --prefix tools/dashboard test`
2. When `prefersTouchInteraction === true` (coarse pointer + no hover / touch), `Enter` inserts newline and explicit Send button sends message. `automated: npm --prefix tools/dashboard test`
3. During IME composition (`event.nativeEvent.isComposing`), `Enter` never sends in either modality. `automated: npm --prefix tools/dashboard test`
4. Primary modality is resolved via `usehooks-ts` `useMediaQuery('(pointer: coarse) and (hover: none)')` without UA sniffing. `automated: npm --prefix tools/dashboard test`
5. `npm --prefix tools/dashboard test` and `npm --prefix tools/dashboard run build` pass. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

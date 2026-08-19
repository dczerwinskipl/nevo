---
id: ux-improvements-version-1.label-commit-hash
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/task-board-and-reviews.md
    - .nevo-ai-local/ux-review/report/04-task-board-and-reviews.md
    - tools/dashboard/src/components/spec-detail.tsx
  optional:
    - tools/specs.mjs
    - .nevo-ai-local/ux-review/screenshots/05-reviews-raw-hash.png
allowed_paths:
  - tools/dashboard/src/components/spec-detail.tsx
  - tools/specs.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Label the raw commit hash in review titles (TASK-4)

## Goal

The "Recenzje" tab lists an item titled "Batch review: multi-provider-agent-sessions
(**55b58f00**)" — a raw git short-hash with no label, next to review items with fully
descriptive titles. Add a label/prefix ("commit 55b58f00") wherever this title is generated
or rendered, or replace it with a date. First locate whether the hash is embedded at
generation time (`tools/specs.mjs`'s batch-review title logic — search `"Batch review"`) or
at render time (`spec-detail.tsx`'s generic document-tab rendering) — fix at whichever site
actually produces the unlabeled string, without duplicating the fix in both places.

## Implementation constraints

- This is a label/format-only change (owner decision D1 permits a backend touch here only if
  it's label/format, never logic) — do not change what data is stored or how reviews are
  identified internally, only how the hash portion of the title displays.
- Do not remove the hash entirely — it's useful identifying information; label it, don't
  delete it (unless replacing with a date, per the report's alternative suggestion).

## Acceptance criteria

1. A review item whose title previously showed a bare hex string now shows it with an
   explicit label (e.g. "commit 55b58f00") or a date instead.
   `inspection: compare against .nevo-ai-local/ux-review/screenshots/05-reviews-raw-hash.png`
2. Other review items with fully descriptive titles are unaffected.
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`
4. If `tools/specs.mjs` is touched: `node --test tools/tests/*.test.mjs` still passes.
   `automated: node --test tools/tests/`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node --test tools/tests/
```

## Out of scope

Any change to how review identity/lookup works internally — display label only.

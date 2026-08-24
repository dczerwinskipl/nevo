---
id: ux-improvements-version-1.label-commit-hash
status: verified
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/task-board-and-reviews.md
    - tools/dashboard/src/components/spec-detail.tsx
  optional:
    - tools/specs.mjs
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

The "Recenzje" tab lists a review item titled "Batch review: multi-provider-agent-sessions
(**55b58f00**)" — a raw git short-hash with no label, next to review items with fully
descriptive titles. The required outcome: no review title shown in the dashboard displays an
undecorated raw hex short-hash — every such title either carries an explicit label (e.g.
"commit 55b58f00") or is replaced with a date.

## Prerequisite — read before starting

`tools/specs.mjs` is under active, separate refactor on this same branch as of this writing.
**Do not start this task until that refactor has stabilized** (check current branch state and
`tools/specs.mjs`'s current shape before beginning — do not assume the file layout or
function names described anywhere else in this repository's history still match). This is a
plain prerequisite note for the implementer to check at start time, not a structured task
dependency — this specification does not use the deterministic workflow's `depends_on`
mechanism, and this task does not introduce it.

## Implementation constraints

- Locate wherever the unlabeled title string is actually produced at the time this task is
  picked up — either where the review title is generated (likely somewhere in
  `tools/specs.mjs`'s current batch-review title logic — search for how review titles are
  built, not for a specific line number, since that may have moved) or, if the title already
  arrives at the dashboard as structured data (e.g. a separate hash field rather than a
  pre-formatted string), fix it at the render site (`spec-detail.tsx`'s document-tab
  rendering) instead. Fix at exactly one of the two sites — do not duplicate the label logic
  in both.
- Prefer the source fix over masking: if the unlabeled string is produced at generation time
  (in `tools/specs.mjs`), fix it there rather than reformatting an opaque pre-built string in
  the dashboard. Only fix at the dashboard render site if the hash is already available to it
  as separate structured data (not string-parsed out of a pre-formatted title).
- This is a label/format-only change (owner decision D1 permits a backend touch here only if
  it's label/format, never logic) — do not change what data is stored or how reviews are
  identified internally, only how the hash portion of a title displays.
- Do not remove the hash entirely — it's useful identifying information; label it, don't
  delete it (unless replacing with a date is the chosen fix).

## Acceptance criteria

1. No review title rendered in the "Recenzje" view contains a bare, unlabeled hex short-hash;
   each such title carries an explicit label (e.g. "commit 55b58f00") or a date instead.
   `inspection: open the Recenzje view for a change whose review title previously contained a bare hash, confirm it is now labeled or replaced with a date`
2. Review items that already have fully descriptive titles are unaffected.
3. The fix exists at exactly one site (generation or render, not both).
   `inspection: confirm no duplicate label-formatting logic was added at both the generation and render sites`
4. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`
5. If `tools/specs.mjs` is touched: `node --test tools/tests/` still passes.
   `automated: node --test tools/tests/`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node --test tools/tests/
```

## Out of scope

Any change to how review identity/lookup works internally, or to the concurrent CLI refactor
itself — display label only, and only once that refactor has stabilized.

---
id: ux-improvements-version-1.consolidate-documentation-tabs
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/navigation-and-ia.md
    - .nevo-ai-local/ux-review/report/03-navigation-and-ia.md
    - tools/dashboard/src/components/spec-detail.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/spec-detail.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: Consolidate the four document tabs into one Documentation view (NAV-3)

## Goal

`spec-detail.tsx` currently renders "Specyfikacja" (`:731`), "Obszary" (`:428`, `:740`),
"Opcje rozwiązań", and "Decyzje" as four separate tabs, each just rendering a markdown file.
"Obszary" is already internally a tree of documents one level deeper than it needs to be.
Merge the four into one "Documentation" tab with a tree on the left (reusing the existing
"Obszary" tree pattern) and the selected document's content on the right.

## Implementation constraints

- Do not change what markdown content is available — only how it's navigated to (fewer top-
  level tabs, one internal tree).
- Reuse the tree component/pattern already implemented for "Obszary" rather than building a
  new tree from scratch.
- The "Przegląd" (overview) tab is unaffected by this task — NAV-3 flags it as over-segmented
  in the *opposite* direction (too much on one screen), but splitting it further is not part
  of this task's fix (the report's suggested fix addresses only the document-tab merge; a
  deeper overview restructuring isn't specified with enough precision to be a testable
  acceptance criterion here).

## Acceptance criteria

1. "Specyfikacja", "Obszary", "Opcje rozwiązań", and "Decyzje" no longer exist as four
   separate top-level tabs; one "Documentation" tab replaces them, with a tree on the left
   listing all four (plus any per-area documents) and content on the right.
   `inspection: open a spec with all four document kinds present, verify single-tab navigation`
2. Every document previously reachable via the four tabs remains reachable via the tree.
   `inspection: enumerate documents before/after, confirm no content becomes unreachable`
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Restructuring the "Przegląd" overview tab's own six stacked concerns — not specified
precisely enough by the review to be a testable fix here.

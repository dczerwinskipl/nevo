---
review-of: task
change: chat-ux-improvements-pt1
task: per-turn-work-presentation
generated: 2026-08-22
verdict: pass
---

# Review: chat-ux-improvements-pt1/per-turn-work-presentation

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — one finding (F1, `AUTO_FIX`) was found and fixed during this review; no
unresolved findings remain.

## Checklist

- [x] Acceptance criteria: 7/7
- [x] Scope: compliant
- [x] Findings: none unresolved (F1 fixed during this review — see below)

## Findings (fixed during this review)

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | fixed | `WorkCollapsedSummary`'s `onToggle` prop is referentially stable across `WorkSummary` re-renders, so its `memo()` actually skips a re-render when `work.items`' identity changes but `count`/`hasFailed`/`expanded` don't (react-component-guidelines.md §9.1, this task's own Implementation constraint) | `onToggle={() => setExpanded(prev => !prev)}` was an inline arrow function recreated on every `WorkSummary` render, defeating `WorkCollapsedSummary`'s memoization on every streamed token — the exact "avoidable re-render of the collapsed summary" the task's own constraints warn against | Read `work-summary.tsx` before the fix; both call sites passed a fresh closure | `tools/dashboard/src/components/work/work-summary.tsx` |

Fixed by wrapping the toggle handler in `useCallback(() => setExpanded(prev => !prev), [])` and reusing the single stable reference at both call sites.

## Verification

- `npm --prefix tools/dashboard test` — passed (156/156)
- `npm --prefix tools/dashboard run build` — passed

## Scope compliance

All touched source paths (`tools/dashboard/src/components/ai-chat.tsx`,
`tools/dashboard/src/components/work/work-summary.tsx`,
`tools/dashboard/src/components/work/work-visibility.ts`,
`tools/dashboard/tests/work-summary.test.mjs`) are within `allowed_paths`. No
`forbidden_paths` touched. `change.yaml`/`specs/index.generated.json` changes are the
deterministic workflow's own status/index bookkeeping, not code under this task's scope.

## Acceptance-criteria coverage

- [x] All 7 acceptance criteria covered — AC1 (one compact Work row per turn, not one
  card per call), AC2 (single current-activity line, prior work compact, new tool
  replaces the slot), AC4 (collapsed count/status text), AC6 (Work grouped strictly by
  `turnId`, never merged), AC7 (dozens of tool events still render as one row) verified
  by inspection of `work-summary.tsx`/`ai-chat.tsx`; AC3 and AC5 additionally covered by
  automated tests (`visibleWorkItemsWhenTerminal`'s expand/collapse behavior,
  `work-summary.test.mjs`).

## Architecture and documentation

Consistent with `docs/development/react-component-guidelines.md` §6/§9.2 (projection
consumed as-is, no re-derivation of grouping in JSX) and §20.1 (module-level component
definitions). §9.1's update-boundary intent is now actually achieved after F1's fix.

## Cross-task note

Correctly depends only on Task 01's `chat-projection.ts` contract
(`semantic_references.dependency_contracts`); does not touch `tools/ai/**`. `AiToolView`
is consumed unchanged in this task's own diff — Task 04 (reviewed separately) later
redesigns its internal presentation without changing the props contract `WorkSummary`
relies on (`toToolCall` still produces a valid `AgentToolCall`).

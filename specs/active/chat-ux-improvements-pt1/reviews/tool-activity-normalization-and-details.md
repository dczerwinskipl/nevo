---
review-of: task
change: chat-ux-improvements-pt1
task: tool-activity-normalization-and-details
generated: 2026-08-22
verdict: pass
---

# Review: chat-ux-improvements-pt1/tool-activity-normalization-and-details

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — no unresolved blocking findings. One non-blocking observation recorded below.

## Checklist

- [x] Acceptance criteria: 9/9
- [x] Scope: compliant
- [x] Findings: none unresolved

## Verification

- `npm --prefix tools/dashboard test` — passed (156/156, includes 11 focused
  `tool-activity-labels.test.mjs` tests)
- `npm --prefix tools/dashboard run build` — passed

## Scope compliance

Touched paths (`tools/dashboard/src/lib/tool-activity-labels.ts`,
`tools/dashboard/src/components/ai-tool-view.tsx`,
`tools/dashboard/tests/tool-activity-labels.test.mjs`) are all within `allowed_paths`.
No `forbidden_paths` touched, no `tools/ai/**` change (task is confirmed frontend-only,
matching its own "Out of scope" note).

## Acceptance-criteria coverage

- [x] AC1-AC3, AC9: three-tier precedence (description → structured normalization →
  generic fallback) directly unit-tested, including the exact scenarios AC9 names
  (description wins over a derivable tier-2 label; `Read`+path and `Bash`+command as
  tier 2; `Bash` with no command and an unmapped tool as tier 3).
- [x] AC4: `activityLabelFor` is a synchronous pure function operating only on already-
  delivered `input`/`toolName` — no `fetch`/`import()` of a network client anywhere in
  `tool-activity-labels.ts`; also asserted directly (`instanceof Promise` is false).
- [x] AC5: raw `toolCall.name` moved into the expanded panel as a labeled "Tool" row
  (`ai-tool-view.tsx`), still rendered unconditionally.
- [x] AC6: the status badge (previously the primary, bold, uppercase-colored element) is
  now a single small icon in the trailing icon group; the activity label is the primary
  bold text.
- [x] AC7: the existing `max-h-48 overflow-auto` capped/scrollable input/output blocks
  are untouched by this diff.
- [x] AC8: `isRunning`/`isCompleted`/`isFailed` (`toolCall.status === ...`) — the exact
  lines that read Task 01's corrected status — are byte-for-byte unchanged by this diff;
  the underlying data correctness (a lingering tool resolving to `'failed'`, never
  `'completed'`) is already covered end-to-end by Task 01's own automated tests
  (`ai-turn-runtime.test.mjs`'s "a tool still running when its turn reaches normal
  turn.completed resolves to failed" case). Verified by inspection that this task's
  redesign does not touch that logic, rather than re-testing it redundantly.

## Non-blocking observation

- N1 (`NON_BLOCKING`): the tier-3 fallback is a single fixed string
  (`"Running command"`) regardless of tool type — AC3's own example text allows either
  "Running command" *or* "Reading file" as acceptable fallbacks, so a single generic
  string satisfies the letter of the AC ("never a blank/undefined label"), but a
  tool-type-aware fallback (e.g. "Reading file" for `Read` with no path) would read
  slightly better. Left as a follow-up candidate, not fixed in this review — it's a
  polish suggestion, not a defect.

## Architecture and documentation

Consistent with `docs/development/react-component-guidelines.md` §4 (reuses the
`ux-improvements-version-1` `ai-mode-meta.ts`-style single-source-of-truth label-lookup
pattern the task cites, adapted since that file doesn't exist yet) and the general
principle of keeping derivation logic out of JSX (label resolution is one pure function
call, not inline branching in the component body).

## Cross-task integration

`WorkSummary`'s `toToolCall()` (Task 03) produces exactly the `AgentToolCall` shape
`AiToolView`/`activityLabelFor` expect (`id`, `name`, `input`, `output`, `status`,
`durationMs`) — no shape mismatch introduced across the two tasks' diffs.

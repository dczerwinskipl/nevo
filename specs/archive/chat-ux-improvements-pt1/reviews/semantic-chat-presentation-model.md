---
review-of: task
change: chat-ux-improvements-pt1
task: semantic-chat-presentation-model
generated: 2026-08-22
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: chat-ux-improvements-pt1/semantic-chat-presentation-model

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`pass` — every acceptance criterion is met, the diff stays within scope, all required
verification commands pass, and the only open item is one non-blocking test-coverage
suggestion that does not affect correctness.

## Checklist

- [x] Acceptance criteria: 18/18
- [x] Scope: compliant
- [x] Findings: 1 non-blocking (see below)

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | NON_BLOCKING | first-review | The pre-existing test exercising Antigravity's successful `tool.completed` wire event (D6 required scenario 13, "Successful Antigravity tool") asserts the resulting `AgentToolCall.status` | Test exercises the success path but never asserts `toolsCompleted[0].status === 'completed'`, so a regression that flipped the default status derivation (`tools/ai/antigravity-adapter.mjs:408`, unchanged by this diff) would not be caught by this suite | `maps reasoning, tool calls, and usage events` (lines 216-254) feeds `{ type: 'tool.completed', toolId: 't1', output: 'content' }` and asserts `reasonings`/`toolsStarted`/`toolsCompleted[0].output`/`texts`/`usage`, but not `.status` | `tools/tests/antigravity-adapter.test.mjs:216-254` |

## Scope compliance

All touched implementation/test paths fall inside `allowed_paths` (`tools/ai/contracts.mjs`,
`tools/ai/transcript-cache.mjs`, `tools/ai/turn-runtime.mjs`, `tools/ai/claude-adapter.mjs`,
`tools/ai/antigravity-adapter.mjs`, `tools/ai/mock-adapter.mjs` — added via the D11 scope
amendment, `tools/dashboard/src/lib/**`, `tools/tests/**`, `tools/dashboard/tests/**`). No
`forbidden_paths` (`src/**`, `tests/NEvo.*/**`, `tools/dashboard/server/**`,
`tools/dashboard/src/components/**`) were touched. The diff also updates
`specs/active/chat-ux-improvements-pt1/change.yaml`, `owner-decisions.md`,
`tasks/01-semantic-chat-presentation-model.md`, and `specs/index.generated.json` — the
task's own spec-workflow bookkeeping (status/self_check, the D11 decision record, the
scope amendment itself, and the regenerated index), not code under `allowed_paths`/
`forbidden_paths` classification.

## Verification

- `node --test tools/tests/claude-adapter.test.mjs` — passed (27/27)
- `node --test tools/tests/antigravity-adapter.test.mjs` — passed (17/17)
- `node --test tools/tests/ai-turn-runtime.test.mjs` — passed (21/21)
- `node --test tools/tests/ai-contracts.test.mjs` — passed (12/12)
- `npm --prefix tools/dashboard test` — passed (140/140, incl. `ai-contract-drift.test.mjs`)
- `npm --prefix tools/dashboard run build` — passed
- `node tools/specs.mjs validate` — passed (16 changes, no errors)

## Acceptance-criteria coverage

- [x] All 18 acceptance criteria covered.

Notable verification points:

- AC1 (Antigravity close-handler ordering): `operation.cancelled`/exit-code are evaluated
  before the still-active tool is resolved; the tool always resolves to `'failed'`
  (never hardcoded `'completed'`) — consistent with D6's governing invariant that a
  lingering tool at close time never received a real successful signal regardless of
  cause. Verified by `tools/ai/antigravity-adapter.mjs:528-556` and the two new tests at
  `tools/tests/antigravity-adapter.test.mjs:517-595`.
- AC2/AC12 (Claude `content_block_stop`): the premature `emitToolCompleted` call was
  removed entirely (`tools/ai/claude-adapter.mjs:346-353`); only the real
  `tool_result`-driven call is terminal. Verified by
  `tools/tests/claude-adapter.test.mjs:625-654`.
- AC3/AC17 (lingering tool at normal `turn.completed`): `completeRunningToolCalls`
  (`tools/ai/transcript-cache.mjs:15-22`) now resolves `'running'` to `'failed'`
  unconditionally; the frontend reducer's `turn.completed`/`turn.failed` handler in
  `nevo-assistant-runtime.ts:236-242` does the same. Verified live and after reload by
  `tools/tests/ai-turn-runtime.test.mjs:379-416`.
- AC4 (contract + wire consistency): `contracts.mjs` validates `status` on
  `tool.completed` (`tools/ai/contracts.mjs:120-123,383-388`),
  `turn-runtime.mjs#emitToolCompleted` forwards it (`turn-runtime.mjs:375-378`), both
  adapters supply it, and the frontend reducer consumes it
  (`nevo-assistant-runtime.ts:220`, defaulting a missing/malformed status to `'failed'`,
  never `'completed'`).
- AC5/AC6 (D7 turn/message correlation): `NormalizedMessage.turnId`/`turnError`
  (`types.ts:388-399`) are populated on every assistant-message creation path, backend
  correlation now matches on `msg.turnId === event.turnId` instead of parsing `id`
  (`transcript-cache.mjs:201-210`), and the projection module documents the verified 1:1
  turn↔message relationship with a pointer to its proving fixture
  (`chat-projection.ts:71-86`). Reload survival verified by
  `tools/tests/ai-turn-runtime.test.mjs:414-416` (`turnError.code` on the persisted
  message).
- AC7/AC8/AC9: `projectChat` (`chat-projection.ts:87-139`) is a documented, pure
  function; `WorkItem` retains `toolName`/`input`/`output`/`status`/`durationMs`
  (`chat-projection.ts:24-31`); `ai-contract-drift.test.mjs` passes unchanged.
- AC10-AC16, AC18: each required scenario has a corresponding test — successful/failed
  Claude tool, Claude non-completion-at-block-stop, successful/cancelled/non-zero-exit
  Antigravity tool, turn-level failure with an active tool, and live/persisted parity —
  across the four `tools/tests/*.mjs` files touched by this diff, all passing. AC13
  ("successful Antigravity tool") is exercised by a pre-existing, unmodified test that
  does not assert the resulting `status` field — see F1.

## Architecture and documentation

`chat-projection.ts` is a standalone library module under `tools/dashboard/src/lib/`,
not computed inline in JSX, consistent with `docs/development/react-component-guidelines.md`
§6/§9.2 (this task ships no component changes to check against those guidelines
directly — Tasks 02/03 consume this module). No architecture/ADR documentation describes
the tool-terminal-status or turn/message-correlation behavior this task corrected, so
there is no drift to reconcile.

## Tests

Every behavior change in this diff has direct test coverage (see Verification and
Acceptance-criteria coverage above), with one narrow exception noted as F1
(non-blocking): the Antigravity successful-tool path's status field is exercised but not
asserted by its existing test.

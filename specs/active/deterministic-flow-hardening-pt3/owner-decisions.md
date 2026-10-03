# Owner decisions — deterministic-flow-hardening-pt3

## D1: No action on provider-quota UX (`recoveryHint`/`alternate-provider`)

- **Question:** When a task start fails with "no credits" on the default provider, should the dashboard start consuming the existing `recoveryHint: 'alternate-provider'` contract (e.g. offering/auto-selecting a secondary provider)?
- **Options considered:** (A) minimal — manual "retry with another provider" affordance in the error banner; (B) balanced — pre-select a fallback provider as a suggestion; (C) full automatic provider rotation per the documented contract.
- **Decision:** None of the above — no change in this spec. The error message already displays correctly when the default provider has no credits; this was not one of the owner's actual problems.
- **Rationale:** Owner confirmed the error surfacing itself works as expected; the request was misread initially as a gap.
- **Consequences:** The `recoveryHint`/`alternate-provider` contract remains unconsumed by the dashboard UI — flagged as a known, intentionally-deferred gap, not fixed here.
- **Date:** 2026-10-03
- **Affected artifacts:** None (out of scope).

## D2: Session-visibility mechanism on creation

- **Question:** How should the dashboard eliminate the "session not found" race between admitting/creating a session and navigating to it?
- **Options considered:** (A) increase the existing single retry to a bounded multi-retry with backoff; (B) make the admission (`/turns`) path invalidate the sessions-list cache the same way `useCreateAgentSession` already does; (C) seed the sessions-list cache optimistically from the creation response (which already carries `sessionId`/`turnId`, or a full `session` object on the dialog path) before navigating, and have the destination screen fall back to a real `GET /api/agent-sessions/:sessionId` fetch (not just another list-query retry) when the session still isn't resolvable — reserving "Sesja nie znaleziona" for a confirmed 404.
- **Decision:** Option C.
- **Rationale:** The backend already knows the session exists at 201/the create response time (`sessionId`, and for the dialog path the full `session` object) — discarding that and re-deriving existence from a separately-cached, eventually-consistent list query is the root cause, not something more retries can fully fix. A genuine fetch-by-id fallback (the endpoint already exists and is unused by this screen) correctly distinguishes "not yet visible" from "really doesn't exist."
- **Consequences:** `specification-detail-content.tsx`'s `proceedWithAgentExecution`, `queries.ts`'s `useCreateAgentSession`, and `agent-session-screen.tsx`'s missing-session handling all change together; see `tasks/01-session-visibility-on-creation.md`.
- **Date:** 2026-10-03
- **Affected artifacts:** `tasks/01-session-visibility-on-creation.md`.

## D3: Execution-policy provider selector fix

- **Question:** Why does clicking a different provider (e.g. "claude") in the "Uruchom z..." dialog appear to do nothing, and how should it be fixed?
- **Options considered:** (A) assume a visual/stacking issue (double dialog overlay) and only investigate after owner reproduction; (B) fix the confirmed root cause directly: `ExecutionPolicySelectionDialog`'s props-sync `useEffect` (`create-agent-session-dialog.tsx:466-513`) lists its own `provider` state as a dependency and unconditionally re-applies `initialConfig.provider`, so every user-driven `setProvider` call (`:681`) is immediately overwritten by the same effect it triggered.
- **Decision:** Option B. Owner reproduced the bug directly (desktop and mobile): selecting "antigravity" is preselected and immovable, clicking "claude" visibly does nothing, blocking starting a task with any non-default provider entirely.
- **Rationale:** Root cause is confirmed in code with exact line citations, not merely inferred; owner's independent reproduction removes the need for further investigation before fixing.
- **Consequences:** Fix changes the effect's dependency/sync strategy so it only reacts to actual prop identity changes, never to the local state it itself owns.
- **Date:** 2026-10-03
- **Affected artifacts:** `tasks/02-execution-policy-provider-selection-fix.md`.

## D4: Scope — one change, two tasks

- **Question:** Do the two remaining fixes (D2, D3) belong in one change, and should they be separate, independently implementable tasks?
- **Decision:** Yes to both — one change (`deterministic-flow-hardening-pt3`), two tasks (`session-visibility-on-creation`, `execution-policy-provider-selection-fix`), since they touch disjoint files and neither needs the other's context.
- **Date:** 2026-10-03
- **Affected artifacts:** `change.yaml`, `overview.md`.

## D5: Workflow mode

- **Question:** Should this change use `workflow.mode: deterministic` (matching `ai-spec-history` and the repo's current direction) or legacy (`approve`/`start`/`complete`/`verify`)?
- **Options considered:** (1) deterministic; (2) legacy.
- **Decision:** Legacy (`workflow.mode` left absent).
- **Rationale:** Owner's stated principle: an agent generally should not be the one driving/mutating the deterministic workflow machinery it is itself being asked to fix here.
- **Consequences:** This change's tasks use `node tools/specs.mjs approve/start/complete/verify` and `/nevo-ai:spec-approve`/`task-start`, not `workflow step start/finish`.
- **Date:** 2026-10-03
- **Affected artifacts:** `change.yaml` (no `workflow:` block).

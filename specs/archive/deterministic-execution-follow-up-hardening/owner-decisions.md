# Owner decisions — deterministic-execution-follow-up-hardening

## D1: Overall redesign direction

- **Question:** How should Scenario A (dirty worktree blocks agent start) and Scenario B/C
  (interrupted active attempt cannot be safely resumed) be fixed?
- **Options considered:** Minimal change (new persistent `resumable` claim status, no
  ceremony) | Balanced improvement (same, plus explicit `--acknowledge-resume` on takeover)
  | Target shape (full module split + ADR now) | Owner's own direction: ownership belongs
  to the live execution/turn, not the workflow attempt; three-way *classification result*
  (`completed | resumable | recovery-required`) computed at turn-terminal time, never
  persisted as a claim status; no explicit acknowledgement step.
- **Decision:** Owner's own direction, as detailed in D2–D6 below.
- **Rationale:** `workflow attempt lifetime != agent turn/execution lifetime` is already
  true in the data model (`workflow_progress` persists independently of any claim) — the
  fix should make the runtime honor that instead of inventing new ceremony or new
  persistent state.
- **Consequences:** No new workspace-writer claim status field. No new CLI flag for
  takeover. Simply starting a new execution for an already-resumable attempt is sufficient
  intent.
- **Date:** 2026-09-30
- **Affected artifacts:** `overview.md` § Proposed architecture, all of Area B.
- **Amended 2026-09-30 (spec-review F1):** `resumable`'s semantic scope was too narrow as
  first recorded here — it read as `workflow_progress.state === 'active'` only. Corrected,
  owner-directed: `resumable` means *the execution/turn ended safely, no ambiguous durable
  operation requires recovery, but the workflow still permits further legal work* —
  covering both an active attempt left unfinished **and** a pre-activation remediation turn
  that ends while its activation blocker still exists (never activated at all). Both
  sub-cases: release the terminated execution's workspace-writer claim, never advance the
  workflow, never create a new attempt, never run continuation, and let a future execution
  legally continue/remediate. See D3 (unchanged: still no persisted claim status) and D2
  (amended separately, below).
- **Amended 2026-09-30 (spec-review follow-up, D2's terminal-classification symmetry):**
  `resumable` gains a **third** sub-case — a finish-operation record left behind by the
  terminating execution whose persisted state is proven deterministically replayable (the
  same D2 rule, applied on the settlement side, not only the admission side). See D2's
  second amendment below for the full rule; this note exists so D1's own list of `resumable`
  sub-cases stays complete and doesn't silently drift from D2.

## D2: Scope of "remediable" activation blockers for Scenario A

- **Question:** Which readiness-failure codes should let a session/turn/agent be created
  anyway (with a structured blocker), versus continuing to block creation entirely?
- **Options considered:** All readiness failures let the agent run and self-report | Only
  workspace/state-hygiene failures the agent can act on (`DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`,
  `FINISH_OPERATION_UNRESOLVED`) let the agent run; task-graph/publication failures
  (`TASK_UNPUBLISHED`, `DEPENDENCY_UNSATISFIED`, `WORKFLOW_TERMINAL`, `TASK_SUSPENDED`,
  executor mismatch, `TASK_BARRIERED`) keep blocking creation.
- **Decision:** The second option — confirmed explicitly by the owner.
- **Rationale:** An agent cannot remediate "task is draft" or "blocked by an unmet
  dependency" from inside a workspace-remediation turn; only workspace/state-hygiene
  failures are things a workspace turn can fix.
- **Date:** 2026-09-30
- **Affected artifacts:** `areas/agent-admission-and-activation-readiness.md`,
  `tasks/02-readiness-classification-split.md`, `tasks/03-non-fatal-admission-for-remediable-blockers.md`.
- **Amended 2026-09-30 (spec-review F2, resolved option 1):** `FINISH_OPERATION_UNRESOLVED`
  is **not** uniformly activation-only. Semantic rule, owner-directed: *a persisted prior
  finish operation is agent-remediable only when its current durable state proves the
  operation is deterministically replayable. Ambiguous or already
  reconciliation-required finish states remain admission-blocking.* The legal remediation
  path for a replayable finish operation is to invoke the normal `workflow step finish`
  path again — never ad hoc git cleanup, never a bypass of reconciliation. A non-replayable
  finish state must not receive ordinary writable execution merely because the top-level
  readiness code is `FINISH_OPERATION_UNRESOLVED`; it routes to the same fail-closed
  recovery/reconciliation semantics as any other ambiguous durable state. The current
  implementation mapping of this distinction is `priorRecord.status === 'running'` (safe
  replay) vs. `'blocked'`/`'unknown'` (ambiguous, already recorded on a prior attempt as
  `reconciliation-required`, per `finish-operation.mjs`'s own `ensureUpdateTask`/
  `ensureCommit`/`ensurePush` reconciliation logic) — the architectural contract is the
  semantic rule above, not these specific string literals, which may evolve independently.
- **Affected artifacts (amendment):** `tasks/02-readiness-classification-split.md`,
  `tasks/03-non-fatal-admission-for-remediable-blockers.md`.
- **Amended 2026-09-30 (spec-review follow-up — the rule governs both sides of the
  lifecycle, not admission alone):** This is not a separate future concern — it is a direct
  consequence of the semantic rule above. *The same rule must hold consistently on both
  sides: (1) when admitting the next execution against an existing finish-operation record,
  and (2) when classifying the terminal execution that left that finish-operation record
  behind.* `execution-settlement.mjs`'s in-flight-finish-operation check previously treated
  any in-flight finish-operation record as unconditionally unsettled/`recovery-required` —
  corrected: if the record a terminating execution left behind is provably
  deterministically replayable under this same rule, terminal reconciliation classifies it
  `resumable` (claim released, finish-operation record left intact, workflow not advanced),
  never `recovery-required`; if ambiguous/blocked/unknown/otherwise not proven replayable,
  it stays `recovery-required`, fail-closed, exactly as before. To prevent the two call
  sites (admission-time readiness, terminal-time settlement) from duplicating this rule and
  drifting into contradictory interpretations, both consume one shared semantic classifier
  (`tasks/01-shared-finish-operation-replayability-classifier.md`) rather than each
  implementing their own running/blocked/unknown check. The architectural contract remains
  semantic — "replayable finish operation" → legal deterministic resume via the normal
  `workflow step finish` path; "ambiguous finish operation" → `recovery-required` — never
  the specific status literals, which stay documented as today's representation only.
- **Affected artifacts (second amendment):** `tasks/01-shared-finish-operation-replayability-classifier.md`,
  `tasks/05-three-outcome-terminal-classification.md`,
  `tasks/06-terminal-reconciliation-adopts-outcome.md`,
  `tasks/13-acceptance-scenario-finish-operation-replay.md`.

## D3: No new persistent workspace-writer claim status

- **Question:** Should turn-terminal classification introduce a new durable
  `resumable` status on the workspace-writer claim file, or stay purely a
  classification/reconciliation-time result?
- **Options considered:** New persisted `resumable` status value | Classification result
  only, claim only ever transitions between held / released / `recovery-required` as today.
- **Decision:** Classification result only — no schema change to the persisted claim.
- **Rationale:** Owner: "resumable może być nazwą wyniku klasyfikacji/reconciliation, ale
  nie powinien być nowym trwałym statusem workspace-writer locka."
- **Date:** 2026-09-30
- **Affected artifacts:** `tasks/05-three-outcome-terminal-classification.md`,
  `tasks/06-terminal-reconciliation-adopts-outcome.md`.
- **Amended 2026-09-30 (spec-review F1):** Still no persisted claim status — this
  constraint is unaffected by D1's broadened `resumable` semantics. The claim only ever
  transitions between held / released / `recovery-required`, regardless of which of
  `resumable`'s two sub-cases (active-attempt-in-progress, or never-activated-and-abandoned)
  produced the release.
- **Amended 2026-09-30 (spec-review follow-up):** Still unaffected by the third
  `resumable` sub-case (a replayable finish-operation record left behind, D2's second
  amendment) — the durable *finish-operation* record itself is left intact by
  classification, which is a different, pre-existing durable artifact
  (`.nevo-ai-local/workflow-operations/...`), not a new field on the workspace-writer claim.
  This decision's constraint (no new claim status/field) still holds exactly as recorded.

## D4: No explicit takeover acknowledgement

- **Question:** Should a different agent/session resuming an already-terminal active
  attempt require an explicit confirmation step (e.g. `--acknowledge-resume`)?
- **Options considered:** Required explicit acknowledgement flag (originally recommended) |
  No ceremony — a confirmed-terminal prior turn plus a new admission attempt is sufficient
  intent.
- **Decision:** No ceremony.
- **Rationale:** Owner: "Jeżeli poprzedni turn jest potwierdzenie terminalny, a user
  uruchamia nowego agenta dla tego samego aktywnego workflow step, samo uruchomienie
  nowego execution jest wystarczająco jawnym intentem." If an audit trail is needed, record
  it automatically instead.
- **Consequences:** Audit trail (D5) substitutes for the removed ceremony.
- **Date:** 2026-09-30
- **Affected artifacts:** `tasks/06-terminal-reconciliation-adopts-outcome.md`.

## D5: Audit trail reuses existing activity infrastructure

- **Question:** How should "previous session/turn → new session/turn → resumed (step,
  attempt) → timestamp" be recorded, if at all?
- **Options considered:** New durable store dedicated to this spec | Extend
  `AgentSessionBindingService` (overwrite-in-place, not append-only — a poor fit) | Reuse
  `tools/specs/activity/store.mjs`'s already-implemented, already-approved `recordActivity`
  (sibling change `ai-spec-history`).
- **Decision:** Reuse the existing activity store; no new durable store.
- **Rationale:** Confirmed by research: `workflow_progress.history` only appends at finish
  time (misses resume events entirely); session bindings overwrite in place (no
  turn-by-turn timeline); the activity envelope/store already exists, is already approved,
  and is unused in production code on this branch — the closest fit, not a new mechanism.
- **Date:** 2026-09-30
- **Affected artifacts:** `tasks/08-resume-and-terminal-audit-trail.md`.

## D6: Terminology

- **Question:** Should the dirty-worktree/unresolved-finish check be renamed "entry gate"
  to match the user-facing framing of "can execution start"?
- **Options considered:** Rename to "entry gate" | Keep "activation precondition" (current
  code/comment terminology), reserve "entry gate" for the existing, unrelated declared
  per-step `entryGates`/`exitGates` schema concept.
- **Decision:** Keep "activation precondition."
- **Rationale:** "Entry gate" is already a distinct, defined concept in this codebase
  (`step.entryGates`/`exitGates`); reusing the term for a different mechanism would create a
  terminology collision, not a UX improvement.
- **Date:** 2026-09-30
- **Affected artifacts:** All spec/task prose in this change.

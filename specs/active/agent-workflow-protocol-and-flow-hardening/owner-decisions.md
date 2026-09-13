# Owner Decisions: Agent Workflow Protocol and Flow Hardening

## D1: Provider-neutral agent workflow protocol ownership and injection point

- **Question:** How and where should the authoritative, provider-neutral deterministic workflow protocol be defined and injected into AI agent sessions?
- **Options considered:**
  1. *Prompt-only injection:* Inject full multi-page protocol instructions into every session prompt in the chat/runner.
  2. *Provider-specific tool adapters:* Write custom lifecycle commands/tools separately for Claude, Codex, Antigravity, and Cursor.
  3. *Canonical documentation + lightweight prompt entry injection + authoritative StepContext contract (Recommended):* Define the single authoritative protocol specification in `docs/development/agent-workflow-protocol.md` and `AGENTS.md`. The chat/runner injects a concise entry header (`[NEvo Context: Specification '...'] ... Run 'node tools/specs.mjs workflow step start <change> <task>'`). All step-specific rules, gates, and contracts are delivered authoritatively in `StepContext`.
- **Trade-offs / Consequences:**
  - Option 1 floods context windows on every turn with redundant boilerplate, wasting token budgets and drifting between tools.
  - Option 2 violates provider neutrality and creates maintenance divergence across Claude, Antigravity, Codex.
  - Option 3 unlocks uniform multi-provider support with minimal token overhead and establishes `StepContext` as the single authoritative runtime contract, foreclosing provider-specific lifecycle branching.
- **Decision:** Option 3. Define the single authoritative protocol specification in documentation (`docs/development/agent-workflow-protocol.md` referenced in `AGENTS.md` and `CLAUDE.md`), inject a concise entry instruction in the session dispatcher, and deliver authoritative execution rules through `StepContext`.
- **Rationale:** Agents should not require bespoke lifecycle implementations per provider. Delivering the protocol through an authoritative, structured `StepContext` guarantees that every agent—regardless of vendor—adheres to identical lifecycle invariants.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/01-provider-neutral-agent-workflow-protocol.md`, task 01

## D2: Session ↔ Task binding identity and runtime persistence

- **Question:** How should the relationship between agent chat sessions and workflow tasks be modeled, identified, and persisted without committing session IDs to Git or requiring agent self-identification?
- **Options considered:**
  1. *Strict 1:1 Session.taskId on the session object:* Bind a session to at most one task ID.
  2. *Global append-only database:* Introduce SQLite or a relational database for session-task telemetry.
  3. *Spec-scoped historical SessionTaskBinding in local runtime storage (Recommended):* Persist in `.nevo-ai-local/sessions/<specId>.json` as many-to-many historical bindings: `{ provider, providerSessionId, specId, taskId, step, attempt, createdAt, lastSeenAt }`. Automatically bound/refreshed during `workflow step start` and `workflow step finish` using ambient process environment (`NEVO_AGENT_PROVIDER`, `NEVO_AGENT_PROVIDER_SESSION_ID`) or server session context.
- **Trade-offs / Consequences:**
  - Option 1 breaks when a user discusses multiple tasks in one chat conversation.
  - Option 2 introduces an unwanted database dependency contrary to project constraints (no SQLite/database in this increment).
  - Option 3 unlocks multi-task chat context and seamless dashboard integration while keeping Git clean and requiring no agent self-awareness. It forecloses global cross-repository querying until the database/timeline increment.
- **Decision:** Option 3. Model `SessionTaskBinding` as a historical, many-to-many relationship persisted per-spec in `.nevo-ai-local/sessions/<specId>.json`. Automatically capture linkage via ambient execution context during `workflow step start` and `workflow step finish`.
- **Rationale:** A single developer conversation naturally touches multiple tasks over time, and multiple agent sessions may work on different attempts or roles for the same task. Local per-spec storage preserves privacy and Git purity while giving the dashboard exact task-conversation linkage.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/04-session-task-binding-and-chat-experience.md`, task 02

## D3: Human verification semantics: first-class human decision step vs gate post-processing

- **Question:** How should human verification be modeled in the deterministic workflow engine — as an exit gate requiring an agent to finish, or as a first-class human-owned decision step?
- **Options considered:**
  1. *Exit gate + agent finish requirement:* Keep `owner-acceptance` exit gate, require human to run `verify-human --confirm`, then coach agent to run `workflow step finish`.
  2. *First-class human decision step with Approve / Request Changes branching (Recommended):* Model `human-verification` in `standard.yaml` as a human-owned decision step with branching transitions: `pass -> verified` (Approve) and `fail -> implementation` (Request Changes). Executing `workflow verify-human` or a dashboard action directly triggers `finishStep` with the human's decision (`pass` or `fail`), without requiring an agent to run finish or synthesizing a git commit if the worktree is clean.
  3. *Free-form conversation branching:* Let the agent infer whether the user approved or rejected based on subsequent chat text.
- **Trade-offs / Consequences:**
  - Option 1 forces unnecessary human coaching: the user approves, but the task remains unverified until an agent is prompted to fabricate a commit and call finish.
  - Option 3 is non-deterministic, risking prompt injection and incorrect transition inference.
  - Option 2 unlocks a seamless, human-led verification flow directly from the chat UI or CLI while preserving the rigorous deterministic state machine. It forecloses treating human verification as merely an automated exit gate.
- **Decision:** Option 2. Model `human-verification` as a first-class human decision step with `pass -> verified` and `fail -> implementation` transitions. The human action (`Approve` or `Request changes`) directly finishes the step via `finishStep`.
- **Rationale:** Human verification is an authoritative operator decision, not a coding step. Requiring an agent to perform post-signoff cleanup or fabricate Git commits is friction that degrades the user experience without adding safety.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/03-human-verification-and-loop-transitions.md`, task 01

## D4: Human feedback persistence across attempts

- **Question:** How should human feedback from a "Request Changes" rejection survive the workflow transition back to `implementation` attempt N+1?
- **Options considered:**
  1. *Chat transcript only:* Leave feedback in the chat message log and expect the agent to read chat history.
  2. *General event-sourcing timeline:* Implement the complete append-only timeline event store immediately.
  3. *Durable history entry + attempt record + StepContext previousTransition enrichment (Recommended):* Persist `feedback` directly in the `workflow_progress.history` entry for `human-verification` (`{ step: 'human-verification', attempt: 1, transitioned_to: 'implementation', result: 'fail', feedback: '...' }`) and in attempt operation storage (`.nevo-ai-local/workflow-operations/...`). `compileStepContext` derives `previousTransition: { from: 'human-verification', result: 'fail', requestedChanges: '...' }` for attempt N+1.
- **Trade-offs / Consequences:**
  - Option 1 fails if a new session is started or if the agent loses chat context window.
  - Option 2 violates non-goals (event sourcing is deferred to `spec-history-and-timeline`).
  - Option 3 unlocks deterministic context handover across different sessions and attempts without adding new database or event-sourcing infrastructure.
- **Decision:** Option 3. Persist human feedback in the completed `workflow_progress.history` record and attempt operation storage, and project it directly into `StepContext.previousTransition` on subsequent attempts.
- **Rationale:** An agent starting implementation attempt N+1 must receive authoritative instructions on why the previous attempt was rejected, even if it runs in a completely new session or another machine.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/03-human-verification-and-loop-transitions.md`, task 01

## D5: Standard Git workspace ownership and clean baseline invariants

- **Question:** How should the deterministic workflow engine manage Git workspace staging and ensure clean transitions between steps and attempts?
- **Options considered:**
  1. *Explicit file enumeration by agents:* Agent must always provide `include: [...]` listing every modified file.
  2. *Unconditional git add -A / blind staging:* Stage all files in repo regardless of pre-existing changes.
  3. *Enforced clean baseline on new attempts + whole-attempt workspace ownership (Recommended):*
     - When allocating a NEW attempt (`completed -> active` or initializing attempt 1): verify working tree is clean of untracked/dirty files (reject with `PRECONDITION_FAILED` if dirty).
     - When resuming an active attempt (`active -> active`): allow dirty files belonging to that attempt.
     - In `commit-and-push` finalize for standard workflow: default `include` to `['*']` (attempt owns workspace) scoped to `allowed_paths`, and handle zero-file modifications gracefully (noop commit if tree is clean, e.g. review passed or human approval).
     - Postcondition of successful finish: working tree is clean.
- **Trade-offs / Consequences:**
  - Option 1 is brittle: agents frequently omit newly created test or helper files from `include`.
  - Option 2 risks committing pre-existing unrelated edits or scratch files.
  - Option 3 unlocks foolproof automated commits for agents while strictly guarding against workspace contamination across attempts.
- **Decision:** Option 3. Enforce a clean working tree before allocating a new attempt, allow dirty files when resuming an active attempt, default `include` to whole-attempt modifications in standard workflows, allow clean-tree noop commits, and require a clean working tree after finish.
- **Rationale:** The workflow engine must own the step workspace once a clean baseline is established. Requiring agents to manually specify file lists leads to forgotten files and dirty tree contamination across attempts.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/02-git-workspace-ownership-and-finalize-hardening.md`, task 01

## D6: Review step durability and evidence persistence

- **Question:** How should findings from an independent review step (`result: fail`) be persisted and made available to implementation attempt N+1?
- **Options considered:**
  1. *Chat message only:* Reviewer prints findings in assistant turn.
  2. *Separate review database:* Build a dedicated review findings schema and table.
  3. *finishContract.artifacts + StepContext previousTransition enrichment (Recommended):* The reviewer writes findings to a markdown file (`specs/active/<change>/reviews/task-<id>-attempt-<attempt>.md`) and references it in `artifacts` during finish (or supplies `feedback` in finish inputs). When attempt N+1 is compiled, `StepContext.previousTransition` exposes `from: 'review'`, `result: 'fail'`, `artifacts: [...]`, `feedback: '...'`.
- **Trade-offs / Consequences:**
  - Option 1 loses findings across session boundaries or long chats.
  - Option 2 is over-engineered for the current increment.
  - Option 3 unlocks durable, auditable review evidence using PR #48's existing `artifacts` contract without introducing new storage engines.
- **Decision:** Option 3. Persist review findings via review markdown artifacts referenced in `artifacts` (and/or `feedback` input), and project them into the next attempt's `StepContext.previousTransition`.
- **Rationale:** An implementation agent cannot fix review findings if they are lost in an ephemeral chat transcript. Persisting the review artifact path and summary ensures continuity across attempts and sessions.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/02-git-workspace-ownership-and-finalize-hardening.md`, task 01

## D7: Chat action and application boundary

- **Question:** Where should workflow orchestration logic live when triggered from the chat UI (Approve, Request Changes)?
- **Options considered:**
  1. *Client-side execution:* Dashboard UI runs git commands and edits `change.yaml`.
  2. *UI-specific state machine:* Dashboard server duplicates workflow transition resolution.
  3. *Unified workflow application commands (Recommended):* The UI issues explicit intent requests to server endpoints (e.g. `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision`), which invoke the authoritative workflow engine functions (`finishStep`). The UI merely renders the resulting authoritative state.
- **Trade-offs / Consequences:**
  - Option 1 creates security and concurrency hazards, bypassing engine validations.
  - Option 2 creates duplicate routing logic that will drift from CLI and CI.
  - Option 3 unlocks a unified, robust architecture where CLI, UI, and future automation share identical engine mechanics.
- **Decision:** Option 3. Maintain a strict application boundary: the UI emits explicit user intent commands to server endpoints, which execute the authoritative workflow engine operations. The UI renders only authoritative workflow state.
- **Rationale:** Workflow state transitions and gate validations must never be duplicated in frontend code. A single engine guarantees identical behavior across CLI and web UI.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/04-session-task-binding-and-chat-experience.md`, tasks 02, 03

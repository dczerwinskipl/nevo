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

## D8: Operator-driven step initiation vs automatic background handover

- **Question:** Who initiates an agent-owned step (e.g. `implementation`, `review`) after a workflow transition, and should the engine automatically spawn or resume subsequent agent sessions in the background?
- **Options considered:**
  1. *Fully autonomous background handover:* The workflow engine automatically dispatches the next agent turn/process as soon as a step transition completes.
  2. *Operator-driven step initiation via dashboard actions (Recommended):* When an agent-owned step completes, the agent STOPs as required by the protocol. The dashboard renders the task's next ready action (e.g. `Task 03 · Review ready` -> `[ Start review ]`). The developer explicitly initiates the next turn/session with hidden bootstrap context.
  3. *Manual terminal CLI prompt coaching:* The developer must open a terminal or manually prompt the agent turn-by-turn.
- **Trade-offs / Consequences:**
  - Option 1 risks runaway token spend, cascading errors across failed steps, and loss of human oversight.
  - Option 3 retains high friction and tests manual developer stamina rather than Nevo's product experience.
  - Option 2 gives developers complete visibility and control at step boundaries, prevents unexpected background executions, and establishes the exact dispatch primitives that future background handover can automate.
- **Decision:** Option 2. Maintain an operator-driven step initiation model in v1. Transitions to agent-owned steps render explicit UI action controls (`[ Start implementation ]`, `[ Start review ]`) that trigger turn dispatch with hidden bootstrap context. Automatic background handover is explicitly deferred.
- **Rationale:** Human-in-the-loop control is essential during the initial adoption of deterministic workflows. Explicit initiation lets developers review attempt artifacts before authorizing the next agent turn.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/05-end-to-end-session-and-task-bootstrap.md`, task 02, task 03

## D9: Agent execution identity and first-turn bootstrap

- **Question:** How should session and task execution identity reach the workflow CLI without requiring the model to discover, author, or pass its own session ID, and how is the end-to-end first-turn bootstrap handled across new, lazy, and multi-task sessions?
- **Answers to Core Architectural Questions:**
  1. *What identity exists before providerSessionId exists?* The Nevo-owned canonical `sessionId` UUID allocated synchronously by `AgentSessionService.createSession(...)` at session creation time. For providers without pre-allocated conversations (e.g. Claude), `providerSessionId` is initially a local placeholder UUID marked `established: false`, but the canonical `sessionId` is durable, unique, and immediately queryable in `AgentSessionBindingService`.
  2. *What trusted data reaches the provider process?* Ambient process environment variables injected into the child process spawn configuration (`childEnv` in Claude, `spawnEnv` in Antigravity, client spawn options in Codex):
     - `NEVO_SESSION_ID`: The canonical Nevo session UUID.
     - `NEVO_AGENT_PROVIDER`: The provider identifier (`'claude'`, `'antigravity'`, `'codex'`).
     - `NEVO_SPEC_ID`: The canonical specification UUID (diagnostic).
     - `NEVO_TASK_ID`: The current active task ID (diagnostic).
     No secrets or untrusted tokens are needed; this is local ambient process inheritance.
  3. *How does CLI discover the current Nevo session?* `tools/specs.mjs` contains `autoBindAgentSession(change, taskId, purpose)`, which calls `readAgentExecutionContext()`. This helper extracts `NEVO_SESSION_ID` and `NEVO_AGENT_PROVIDER` from `process.env`. `autoBindAgentSession` calls `bindingService.bindSessionSync` to record or refresh the current step/attempt linkage without the model authoring or passing any flags. Session ID is never an agent-authored input or command parameter; it is exclusively resolved from trusted ambient runtime context.
  4. *How is providerSessionId attached later?* When the provider materializes its native conversation (e.g., upon first streaming event or turn completion), it invokes the server callback `onSessionEstablished(allocatedProviderSessionId)` / `setProviderSessionId`. `AgentSessionBindingService.markSessionEstablished(provider, allocatedProviderSessionId)` updates the binding record: it durably clears `established: false` and sets `providerSessionId = allocatedProviderSessionId`. The canonical `sessionId` remains invariant.
  5. *What does the agent see in its prompt?* The visible chat transcript displays a clean, human message (e.g. `"Implement task 03: <title>"`). The agent's input prompt payload is pre-pended with a minimal, hidden protocol context header (`[Nevo Workflow Context] ... Run 'node tools/specs.mjs workflow step start <change> <task>'`). It is injected only on the first turn of an attempt or upon an explicit task switch.
  6. *Which parts are diagnostic vs authoritative?*
     - **Diagnostic:** The prompt header (guiding the agent), the environment variables `NEVO_SPEC_ID` and `NEVO_TASK_ID`, and chat message bubbles. If an agent hallucinates an ID in chat, it has zero system effect.
     - **Authoritative:** The ambient process environment `NEVO_SESSION_ID` and `NEVO_AGENT_PROVIDER`, the workflow manifest `change.yaml`, and the `StepContext` emitted by `workflow step start`. `StepContext` alone defines allowed paths, forbidden paths, gates, previous transition feedback, attempt number, and finish criteria.
  7. *How is task switching represented?* Within a single conversation session, the session maintains historical bindings (`SessionTaskBinding[]`) representing all tasks it has worked on, and exactly one `activeTaskId` representing the current interaction context. Task switching occurs strictly via explicit operator action in the dashboard (e.g. clicking a task chip in the workflow bar). The next turn dispatched in that session injects the new task's `[Nevo Workflow Context]` header, and the next `workflow step start` registers the new task under the same `sessionId`. Free-form chat text never triggers task switching.
- **Options considered:**
  1. *Prompt-instructed session ID authoring:* Instruct the model via system prompt to pass an ID flag (e.g. `node tools/specs.mjs workflow step start <spec> <task> --session-id <id>`).
  2. *Blocking provider session allocation:* Block all agent turn execution until the provider confirms a native conversation ID.
  3. *Nevo canonical session UUID + ambient process environment inheritance + onSessionEstablished reconciliation (Recommended):* Implement the 7-part architecture detailed above.
- **Trade-offs / Consequences:**
  - Option 1 relies on unreliable model adherence, exposes internal session identifiers to prompt tampering, and breaks provider neutrality.
  - Option 2 causes latency and fails for providers that allocate conversation IDs lazily on turn completion.
  - Option 3 guarantees 100% reliable session linkage from the very first tool call, requires zero model self-awareness, and handles both pre-allocated and lazy provider session lifecycles uniformly.
- **Decision:** Option 3. Allocate a canonical `sessionId` UUID at session creation time, propagate it to provider child processes via `NEVO_SESSION_ID` and `NEVO_AGENT_PROVIDER`, discover it ambiently in CLI `autoBindAgentSession`, and resolve provider-native IDs asynchronously via `onSessionEstablished` reconciliation.
- **Rationale:** Execution identity must be trusted, ambient, and transparent. The agent should only focus on executing the step, while ambient runtime infrastructure automatically establishes tracking.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/05-end-to-end-session-and-task-bootstrap.md`, task 02, task 03

## D10: Temporary deterministic workflow UI mode

- **Question:** How should the new deterministic workflow chat surface and composer action modes be enabled alongside the existing dashboard experience without breaking current workflows?
- **Options considered:**
  1. *Immediate global cutover:* Replace all existing task and chat surfaces with the deterministic UI across all specifications.
  2. *Persisted manifest flag:* Add a UI mode property to `change.yaml` or workflow schema.
  3. *Presentation-only UI toggle in localStorage (Recommended):* Add a compact toggle in the dashboard header or settings (`Workflow Experience: [ Classic ] [ Deterministic Preview ]`) stored in browser `localStorage`. When set to `Deterministic Preview`, it renders the task action bar and composer modes for specifications with `workflow.mode: deterministic`. It does not mutate backend state or alter legacy workflows.
- **Trade-offs / Consequences:**
  - Option 1 risks breaking existing workflows during development before all edge cases are proven.
  - Option 2 pollutes domain specification files with transient UI presentation concerns.
  - Option 3 enables immediate side-by-side verification and testing without altering Git-tracked files or affecting existing classic sessions, and can be cleanly decommissioned once the deterministic workflow becomes the default.
- **Decision:** Option 3. Implement a presentation-only toggle in client `localStorage` (`nevo:workflow-ui-mode: 'classic' | 'preview'`).
- **Rationale:** Decouples frontend feature validation from domain-level persistence and ensures non-deterministic specifications remain completely unaffected.
- **Date:** 2026-09-13
- **Affected artifacts:** `overview.md`, `areas/04-session-task-binding-and-chat-experience.md`, task 03

## D11: Workflow mode selection ownership and manifest lifecycle immutability

- **Question:** Who owns the decision to configure or change `workflow.mode` in a specification manifest, and what are the boundaries regarding agent mutation of manifest lifecycle state?
- **Options considered:**
  1. *Autonomous agent inference:* Let agents infer `workflow.mode: deterministic` based on task context or file topics.
  2. *Strict owner/product authority + manifest immutability (Recommended):* Workflow mode selection is exclusively an owner, product, or application-level decision. If omitted, mode defaults to `legacy`. Agents must never autonomously add or alter `workflow.mode` or `workflow.version`, nor directly edit `change.yaml` lifecycle fields (`status`, `workflow_progress`, attempt state, transition history). Agent intent must flow strictly through validated CLI commands (`workflow step start`, `workflow step finish`, human decision endpoints) or future AI application APIs.
- **Trade-offs / Consequences:**
  - Option 1 leads to accidental, premature dogfooding of unfinished workflow features on specifications that were intended to run under legacy lifecycles, polluting manifests with invalid runtime progress.
  - Option 2 enforces a clean, deterministic ownership boundary: Nevo owns lifecycle validation, state machine integrity, and persistence, while the agent focuses purely on task-level implementation or review work.
- **Decision:** Option 2. Enforce strict owner authority over `workflow.mode`. Unconfigured specifications remain legacy. Agents must not mutate lifecycle fields in `change.yaml`.
- **Rationale:** Prevents accidental dogfooding, preserves backward compatibility as the default, and maintains the integrity of the authoritative Nevo workflow engine.
- **Date:** 2026-09-14
- **Affected artifacts:** `AGENTS.md`, `docs/development/agent-workflow-protocol.md`, `specs/active/agent-workflow-protocol-and-flow-hardening/change.yaml`

## D12: Sequencing of first deterministic end-to-end dogfood flow

- **Question:** When and where should the first real end-to-end deterministic workflow dogfood run take place?
- **Options considered:**
  1. *Retroactive dogfooding on PR #51:* Force the current specification (`agent-workflow-protocol-and-flow-hardening`) to run under deterministic mode while building that very infrastructure.
  2. *Sequenced dogfooding on a subsequent dedicated specification (Recommended):* Complete PR #51 under the standard legacy lifecycle. After PR #51 merges, create a dedicated new specification (e.g. `spec-history-and-timeline`) explicitly configured with `workflow: { mode: deterministic }` and execute the full controlled review and human-verification loop there.
- **Trade-offs / Consequences:**
  - Option 1 causes circular dependencies, unverified error states, and corrupted manifest tracking because the runtime tooling is still being built and corrected under the running task.
  - Option 2 allows PR #51 to establish complete, verified, hardened infrastructure first, ensuring the subsequent dogfood smoke run operates on a fully tested foundation.
- **Decision:** Option 2. Complete PR #51 under legacy lifecycle; conduct the first deliberate end-to-end deterministic smoke run on a new dedicated specification after PR #51 is finalized.
- **Rationale:** Engineering rigor requires separating infrastructure construction from the testbed that validates it.
- **Date:** 2026-09-14
- **Affected artifacts:** `specs/active/agent-workflow-protocol-and-flow-hardening/change.yaml`, `docs/development/agent-workflow-protocol.md`

## D13: Scope amendment — Task 02's session-lookup fix in `agent-session-screen.tsx`

- **Question:** Commit `1f927040` fixed a real production bug (navigated sessions failing to resolve once a provider's native session id replaced the canonical placeholder) by touching `tools/dashboard/ui/screens/agent-session/agent-session-screen.tsx`, which fell under Task 02's declared `forbidden_paths: tools/dashboard/ui/**`. How should this out-of-declared-scope fix be resolved?
- **Options considered:**
  1. *Revert/re-attribute:* Drop the fix from Task 02's diff and re-file it under a different task.
  2. *Amend Task 02's declared scope (Recommended):* Move the specific file into Task 02's `allowed_paths` and drop the now-closing task's blanket `tools/dashboard/ui/**` restriction, since the fix is real, tested, and correct, and Task 02 has no further work planned.
- **Trade-offs / Consequences:**
  - Option 1 would reintroduce a real, already-fixed session-resolution bug for no benefit.
  - Option 2 accepts a one-file scope widening on a task that is otherwise done, in exchange for keeping a genuine fix.
- **Decision:** Option 2. Owner confirmed the fix is wanted regardless of the declared path boundary.
- **Rationale:** The boundary existed to keep Task 02 from doing Task 03's (chat-surface) work; a one-line defensive lookup fallback in the session screen is not that, and reverting it purely for scope hygiene would be a regression.
- **Date:** 2026-09-15
- **Affected artifacts:** `specs/active/agent-workflow-protocol-and-flow-hardening/tasks/02-session-task-binding-and-workflow-server-endpoints.md`


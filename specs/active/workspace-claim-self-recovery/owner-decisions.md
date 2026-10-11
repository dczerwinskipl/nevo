# Owner decisions — workspace-claim-self-recovery

## D1: Recovery model for a stale `recovery-required` workspace-writer claim

- **Question:** How should the system stop a settled-but-`recovery-required` agent claim from blocking human actions indefinitely?
- **Options considered:** (1) Minimal: better diagnostics + operator `recover` command, fail-closed otherwise | (2) Balanced: self-heal on contention using the shared settlement classifier, plus operator command and diagnostics | (3) Target shape: liveness-bound lease, no persisted `recovery-required` state
- **Decision:** Option 2 — self-heal on contention, plus operator command, plus actionable diagnostics.
- **Rationale:** Not given beyond choosing the recommendation. The recommendation's reasoning (recorded for traceability, not as owner rationale): one shared classifier for admission and settlement matches ADR-0009's rejection of semantic drift; option 3 costs and risks far more than the gain over option 2.
- **Consequences:** `acquireWorkspaceWriter` re-assesses an agent `recovery-required` claim before returning `blocked`. Genuinely ambiguous claims still block (fail-closed is preserved). Option 3's lease model is explicitly out of scope.
- **Date:** 2026-10-11
- **Affected artifacts:** tasks 01, 02, 03

## D2: ADR-0009 is amended in place

- **Question:** Does this change amend ADR-0009 or supersede it with a new ADR?
- **Options considered:** Amend ADR-0009 | New superseding ADR
- **Decision:** Amend ADR-0009 (stated as part of the selected option 2).
- **Consequences:** Task 05 adds an amendment section to ADR-0009 describing on-demand re-assessment and the operator recovery path. ADR-0009's statement that `recovery-required` "blocks future admissions until repaired" is refined, not reversed: it blocks until re-assessment proves the claim settled, or an operator repairs it.
- **Date:** 2026-10-11
- **Affected artifacts:** task 05, `docs/decisions/ADR-0009-agent-admission-and-execution-ownership-model.md`

## D4: Scope extended to stale human-submit operations and `pending` handling

- **Question:** Should the stale-`pending` human-submit operation defect (retry is a silent
  no-op) be added to this change?
- **Options considered:** Add to this change | Separate change
- **Decision:** Add to this change (owner instruction, 2026-10-11: "dopisz te problemy do
  specki").
- **Consequences:** New task 06 (server-side resume/supersede and explicit response
  states); task 04 extended so the UI does not treat `pending` as success; task 05 also
  documents the new behavior. The exact resume-vs-supersede mechanics are specified as
  behavior in task 06; mechanics are an implementation detail.
- **Date:** 2026-10-11
- **Affected artifacts:** tasks 04, 05, 06, overview.md

## D5: Add blocked-action verification cases (agent starts included)

- **Question:** Should the "review gave no feedback" failure be covered by this change?
- **Options considered:** Cover it here | Separate change
- **Decision:** Cover it here, as a separate verification case (owner instruction,
  2026-10-11: add it "jako osobny case do weryfikacji").
- **Consequences:** New task 07 with verification cases VC1–VC5, reproduced before any
  fix. Session reuse and batch-review session choice are explicitly **not** part of this
  change; they go to a separate specification.
- **Date:** 2026-10-11
- **Affected artifacts:** task 07, overview.md

## D3: Separate change, not part of ai-spec-history

- **Question:** Where does this work live?
- **Options considered:** New change | Extra tasks in `ai-spec-history`
- **Decision:** New change `workspace-claim-self-recovery` (owner asked for a new specification).
- **Consequences:** `ai-spec-history` is untouched.
- **Date:** 2026-10-11
- **Affected artifacts:** change.yaml

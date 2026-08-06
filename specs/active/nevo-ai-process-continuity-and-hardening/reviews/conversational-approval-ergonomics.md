---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: conversational-approval-ergonomics
generated: 2026-08-05
verdict: changes-required
unresolved_required_fixes: 1
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/conversational-approval-ergonomics

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`changes-required` — one unresolved `AUTO_FIX` finding (F1: the task's own
`## Verification` command fails as literally written on this repository's target
platform); every acceptance criterion the conversational-layer diff itself owns is
otherwise met, with clean scope compliance and passing gating validation.

## Scope compliance

Confirmed. Task 04's own implementation commit (`4db71f31`, "feat(specs): conversational
approve+start combined transition, D17 resume-in-place, inline offers (task 04)")
touches exactly four files, all four listed verbatim in `allowed_paths`:
`.claude/commands/nevo-ai/spec-approve.md`, `.claude/commands/nevo-ai/spec-review.md`,
`.claude/commands/nevo-ai/task-review.md`, `.claude/skills/nevo-ai-spec-workflow/SKILL.md`
(`git show --stat 4db71f31`). No file in `forbidden_paths` (`src/**`, `tests/**`,
`examples/**`, `docs/development/**`, `tools/specs/lifecycle.mjs`,
`tools/specs/service.mjs`) appears anywhere in this commit's diff. The task's own two
follow-on commits (`faf29f1` marking it `implemented`, `4e9c218` regenerating indexes)
touch only `change.yaml` and `specs/index.generated.json` — status transitions and
generator output, not hand-edited generated artifacts. `git status --porcelain` shows no
uncommitted changes to any file this task owns. Three other files nominally in this
task's `allowed_paths` (`spec-review.md`, `task-review.md`, `SKILL.md`) were also later
edited by tasks 08/11/12 and by the `aa71381` tooling fix commit — inspected each via
`git show <commit> -- <file>` and confirmed none touches the D3/D17 combined-transition
material task 04 owns (task 08 extended the batch-continuation section task 04
scaffolded; task 11/12 added unrelated fingerprint/semantic-reference-completeness and
implementation-review sections; `aa71381` only touched the fingerprint-recording steps).
No drift or regression into task 04's own material was found.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | first-review | The task's own `## Verification` fenced block contains a command that actually executes successfully in this repository's environment | `node --test tools/tests/` (as literally written) fails outright — not a test failure, a runner-resolution failure — on both Git Bash and Windows PowerShell; the corrected form `node --test tools/tests/*.test.mjs` (already used by `package.json`'s own `test` script and by task 12's own Verification section) succeeds. Real consequence beyond documentation: `parseVerificationCommands` (`tools/specs/service.mjs:522`) extracts this exact line verbatim for `node tools/specs.mjs self-check`; if self-check is ever run against this task, it would record a spurious `self_check.status: failed` and could incorrectly hard-stop a future batch under D24, despite the implementation itself being correct. Fix: change line 114 of the task file to `node --test tools/tests/*.test.mjs`. | Ran `node --test tools/tests/` via both Bash and PowerShell tools — both exited 1 with `Cannot find module 'D:\repos\git\nevo\tools\tests'` / `not ok 1 - tools\\tests`, zero tests executed. Ran `node --test tools/tests/*.test.mjs` — 669 tests, 668 passing, 1 failing (see F2). `tools/specs/service.mjs:522-526` (`parseVerificationCommands`) confirmed to extract the Verification block's lines verbatim, one command per line, with no glob correction applied. | `specs/active/nevo-ai-process-continuity-and-hardening/tasks/04-conversational-approval-ergonomics.md:114` |
| F2 | INFORMATIONAL | — | — | Non-gating repository check: failed — `node tools/specs.mjs check` reports `stale: specs/index.generated.json`. This is **not** self-caused by task 04: its own commit (`4db71f31`) touches none of `specs/**`/`docs/**` sources, and `git status --porcelain` shows the working tree clean relative to `HEAD` (no pending, unregenerated edit from this session). The one failing automated test (`tools/tests/cli-smoke.test.mjs` — "check exits 0 when generated indexes are current") fails for the same, unrelated reason. Gating validation is unaffected. | `node tools/specs.mjs validate` → `Validated 6 changes — no errors.` (gating, passed). `node tools/specs.mjs check` → `stale: specs/index.generated.json` / `Run: node tools/specs.mjs generate` (non-gating, failed, reason known and unrelated to this task's diff). | `specs/index.generated.json` |
| F3 | NON_BLOCKING | first-review | Automated coverage exists that genuinely simulates a `confirm-required` stop inside the combined `approve`→`start` flow and proves `approve` runs exactly once through that simulated stop-and-resume | The `describe('D17 — combined-transition repair-and-retry', ...)` block in `tools/tests/e2e-workflow.test.mjs` (lines 512-542) exercises `inspectApprovePostconditions`/`resolveAfterConfirmedRepair` directly with pre-built, already-resolved inspection objects (e.g. `resolveAfterConfirmedRepair({ result: 'safe_to_retry', missing: [] })`) rather than driving a real `confirm-required`→repair→re-inspect sequence; the "approve computed exactly once" claim in that test is a code comment, not an assertion. This is an inherent limit of testing a conversational sequence that lives in `spec-approve.md`'s prompt text rather than in a single orchestrating function — the deterministic primitives are genuinely unit-tested (legitimate coverage, correctly attributed to tasks 02/03), but AC5's specific "approve called exactly once, no second `/nevo-ai:task-start` invocation" guarantee is currently verifiable only by manual trace of `spec-approve.md` §"Approve and start" (traced this run — the wording correctly enforces both properties). Candidate for follow-up recording (not recorded — requires owner-facing confirmation, out of scope for this subagent run). | `tools/tests/e2e-workflow.test.mjs:512-542`; `tools/specs/lifecycle.mjs:391-402` (`resolveAfterConfirmedRepair`); `.claude/commands/nevo-ai/spec-approve.md:61-111` (§"Approve and start", manually traced). | `tools/tests/e2e-workflow.test.mjs:512-542` |
| F4 | INFORMATIONAL | — | — | Manual trace confirms every acceptance criterion this task's own diff owns. | See "Acceptance-criteria coverage" below for the per-criterion trace. | `.claude/commands/nevo-ai/spec-approve.md`, `.claude/commands/nevo-ai/spec-review.md`, `.claude/commands/nevo-ai/task-review.md`, `.claude/skills/nevo-ai-spec-workflow/SKILL.md` |

## Acceptance-criteria coverage

1. **`spec-approve` offers exactly four outcomes, none pre-selected.** Met. Current
   `spec-approve.md` states "This command offers exactly four outcomes and no others:
   approve the selected task, approve and start it, keep it as draft, or show the review
   report," followed by the four-item menu (Flow step 3) with no default marked.
2. **A `start` failure after successful `approve` leaves status `approved`; a
   `partially_completed` failure records `execution.suspension` with
   `previous_action: start`.** Met at the conversational-command level: §"Approve and
   start" branch for `partially_completed` states "relay exactly what the CLI reported
   (including any `execution.suspension` it wrote, `previous_action: start`) and
   stop... `approved` status is untouched either way" — correctly defers the actual
   write to the CLI (task 02/03's own scope, `tools/specs/lifecycle.mjs`/`service.mjs`,
   both forbidden to this task).
3. **`spec-review` reaching `ready-for-approval` offers inline approval without
   skipping `spec-approve`'s own CLI-enforced gate.** Met. `spec-review.md` step 10a
   requires presenting "exactly `/nevo-ai:spec-approve <change-id> <task-id>`'s own
   Flow step 3 menu (all four options...)" and following that command's own Flow step 4
   "exactly — including `node tools/specs.mjs approve`'s own fresh fingerprint/verdict
   re-check, which still runs and is still what actually enforces the gate."
4. **`task-review`'s batch-continuation offer never appears when no active batch record
   exists.** Met by composition: task 04's own commit added only the forward-compatible
   existence check (explicitly out-of-scope for the visible offer, per its own task
   file); task 08 (`a25ad2f`) built the real offer on top, gated on
   `node tools/specs.mjs batch-status <change-id>` reporting `active: true` **and**
   `<task-id>` present in `intent.orderedTasks` — re-verified as task 08's own
   acceptance criteria per this task's own note, not re-litigated here.
5. **A `confirm-required` `start` failure, once confirmed, resumes and completes
   without a second `/nevo-ai:task-start` invocation; `approve` runs exactly once.** Met
   by the command text (manual trace) — see F3 for the caveat that the "exactly once"/
   "no second invocation" guarantee is verified by trace rather than by a test that
   drives a genuine simulated confirm-required stop.
6. **An `unsafe_manual` failure stops and reports without ever presenting a
   confirmation prompt.** Met. §"Approve and start": "**`unsafe_manual`**... relay the
   recovery detail and stop. **Never present a confirmation prompt for this**..." —
   unambiguous, matches D17 exactly. Also directly asserted in
   `tools/tests/e2e-workflow.test.mjs:535-541` (`resolveAfterConfirmedRepair` never
   turns an `unsafe_manual` input into a `confirm-required`-shaped result).
7. **Approval remains persisted when a `start` failure is `not_retryable`.** Met.
   §"Approve and start": "**`not_retryable`**... relay the exact error and stop;
   `approved` status is untouched" — and, in every branch, "`approve` from step 1 is
   never rolled back and never re-run."

## Architecture and documentation

No conflict found with `overview.md`, D2/D3/D8/D17 (`owner-decisions.md`), or
`areas/conversational-continuity.md` — the implementation matches D17's "repair-and-retry,
not stop-and-restart" model precisely, including the "confirm at most once per repair"
constraint (§"Approve and start": "**Ask for confirmation at most once for this
repair**"). Documentation impact requirement met: `SKILL.md` §"Preventing premature
implementation" was updated in this task's own commit to describe the fourth
`spec-approve` outcome, and still correctly states it "never" changes for any outcome
other than the explicit "approve and start" choice. `docs/development/**` is untouched,
correctly (forbidden and not implicated — this is a conversational-layer-only change).

## Tests

No test files are in this task's `allowed_paths` (by design — the underlying mechanisms
this task's conversational commands invoke are `tools/specs/lifecycle.mjs`/`service.mjs`,
both explicitly `forbidden_paths` here, owned by tasks 02/03). The task's own acceptance
criteria correctly label AC2/AC5/AC6/AC7 as extending task 02/03's test coverage rather
than adding new tests under this task. That coverage exists and is real
(`tools/tests/e2e-workflow.test.mjs`'s `D17` describe block, `tools/tests/start.test.mjs`,
`tools/tests/recovery.test.mjs`), with the depth caveat recorded as F3
(`NON_BLOCKING`).

**Full-suite verification evidence (this run):**

```
node tools/specs.mjs validate
→ Validated 6 changes — no errors.

node --test tools/tests/*.test.mjs
→ tests 669, pass 668, fail 1 (unrelated stale-index check, see F2)

node tools/specs.mjs check
→ stale: specs/index.generated.json (non-gating, unrelated to this task's diff)
```

The task file's own literal Verification command (`node --test tools/tests/`, no glob)
does not execute at all in this environment — see F1.

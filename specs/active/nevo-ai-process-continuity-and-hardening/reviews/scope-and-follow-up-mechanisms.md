---
review-of: task
change: nevo-ai-process-continuity-and-hardening
task: scope-and-follow-up-mechanisms
generated: 2026-08-05
verdict: changes-required
unresolved_required_fixes: 1
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-process-continuity-and-hardening/scope-and-follow-up-mechanisms

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Verdict

`changes-required` — one unambiguous, mechanical documentation gap (F1) leaves
`task-review.md`'s own scope-compliance instruction inconsistent with the
`consequential_paths` behavior this task built and validated; every automated
acceptance criterion (1-9) passes and all named Verification commands pass.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | AUTO_FIX | first-review | `task-review.md` step 4 states writes must stay within `allowed_paths` and away from `forbidden_paths`, "a violation here is always a blocking finding, no exceptions," with no `consequential_paths` carve-out | The task's own "Implementation constraints" bullet 3 explicitly requires updating this instruction ("A write inside `consequential_paths` is not flagged as a scope violation by `task-review.md`'s existing step 4 instruction — update that instruction"), and area requirement 10 requires the same behavior. `tools/specs/validation.mjs`'s own doc comment for `validateConsequentialPaths` already asserts this as settled fact ("a `consequential_paths` write is not flagged as a scope violation by `task-review`"), but the instruction it relies on was never changed. As written today, a literal reading of step 4 would flag a legitimate write inside a task's own `consequential_paths` (e.g. this very task's own `consequential_paths: [follow-ups.yaml]`) as a blocking scope violation. Fix: add a `consequential_paths` carve-out to step 4, mirroring the wording already used for the multi-task/batch review shapes later in the same policy. | Read `.claude/commands/nevo-ai/task-review.md` step 4 verbatim just now: "Verify the diff stays within `allowed_paths` and does not touch `forbidden_paths` — a violation here is always a blocking finding, no exceptions." `grep -n "consequential" .claude/commands/nevo-ai/task-review.md` returns zero matches. Confirmed the task-06 implementing commit (`7f17b6e`) only added step 7a ("record as follow-up") to this file — it never touched step 4. Confirmed via `git log -p` that no later commit on this branch touched `task-review.md` for this purpose either (later `task-review.md` edits — `aa71381` — only added batch-continuation/status-reporting content, not a `consequential_paths` carve-out). | `.claude/commands/nevo-ai/task-review.md` (step 4) |
| F2 | INFORMATIONAL | — | — | Gating validation clean: `node tools/specs.mjs validate` → "Validated 6 changes — no errors." `node tools/docs.mjs validate` → "Validated 60 documents — no errors." | Command output, this run | — |
| F3 | INFORMATIONAL | — | — | Non-gating repository check: `node tools/specs.mjs check` reports `stale: specs/index.generated.json`. Traced the cause by running `node tools/specs.mjs generate` and diffing the result: the only change was task 12 (`implementation-review-orchestration`, currently `in-implementation`, not part of this task's scope) gaining a `self_check` block in `change.yaml` after the last index generation — unrelated to this task's own diff, which touches no `specs/**`/`docs/**` sources requiring regeneration. Per review-policy's "Exception, task review only" rule, this is the "some other, unrelated part of the repo is stale" case, not self-caused staleness — informational, does not affect this task's verdict. The accidental regeneration performed to diagnose this was reverted (`git checkout -- specs/index.generated.json specs/active.generated.md specs/archive.generated.md`) to keep this review read-only. `node tools/docs.mjs check` → "Indexes are current." | Command output and diff, this run | `specs/index.generated.json` |
| F4 | INFORMATIONAL | — | — | Full Node test suite (`node --test tools/tests/*.test.mjs`): 669 tests, 668 pass, 1 fail. The one failure is `tools/tests/cli-smoke.test.mjs` → "check exits 0 when generated indexes are current," the same root cause as F3 (task 12's uncommitted `self_check` write), not a regression in this task's own scope. This task's own named Verification commands (`validation.test.mjs`, `follow-ups.test.mjs`, `fingerprint.test.mjs`, `task-lifecycle.test.mjs`, `node tools/specs.mjs validate`) all pass in full — 11/11, 29/29, 64/64, 106/106 respectively, and `validate` reports no errors. Note: this task's own "## Verification" section already names explicit test files (never the bare `tools/tests/` directory), so the known Windows glob pitfall (bare `node --test tools/tests/` finding no tests) does not apply to this task's own verification commands — confirmed by actually running each one as written. | Command output, this run | `tools/tests/*.test.mjs` |
| F5 | NON_BLOCKING | first-review | `.claude/skills/nevo-ai-spec-workflow/templates/review-report.md`'s "Scope compliance (task review only)" section text also has no `consequential_paths` carve-out | Same underlying gap as F1, one section over — but `templates/review-report.md` is not in this task's own `allowed_paths`, so it cannot be `AUTO_FIX`ed as part of this task's diff; candidate for follow-up recording (not recorded — requires owner-facing confirmation, out of scope for this subagent run). | `grep -n "consequential" .claude/skills/nevo-ai-spec-workflow/templates/review-report.md` returns no match | `.claude/skills/nevo-ai-spec-workflow/templates/review-report.md` |

## Scope compliance

Confirmed explicitly. The task-06 implementing commit (`7f17b6e`) touches exactly:
`.claude/commands/nevo-ai/spec-audit.md`, `.claude/commands/nevo-ai/spec-finalize.md`,
`.claude/commands/nevo-ai/task-review.md`, `.claude/skills/nevo-ai-spec-workflow/templates/task.md`,
`tools/specs.mjs`, `tools/specs/lifecycle.mjs`, `tools/specs/service.mjs`,
`tools/specs/validation.mjs`, `tools/tests/follow-ups.test.mjs`, `tools/tests/validation.test.mjs`
— every file is listed in this task's own `allowed_paths`. Two later PR-review-packet fix
commits (`075fa9e`, `ef4341c`) touch this task's scope again (`tools/specs/service.mjs`,
`tools/specs/validation.mjs`, `tools/specs.mjs`, `.claude/commands/nevo-ai/spec-finalize.md`,
`tools/tests/follow-ups.test.mjs`, `tools/tests/validation.test.mjs`, plus
`docs/ai/specification-workflow.md` and `tools/tests/context.test.mjs`/`fingerprint.test.mjs`,
which belong to other tasks' own `allowed_paths`, not this one, but are additive fixes to
shared files this task also owns) — none of it touches `forbidden_paths`
(`src/**`, `tests/**`, `examples/**`, `docs/development/**`, `docs/usage/**`). No scope
violation found. The task's own `consequential_paths` entry
(`specs/active/nevo-ai-process-continuity-and-hardening/follow-ups.yaml`) is correctly
treated as non-scope-violating for this review — see F1/F5 for the gap in the *documented*
instruction that would otherwise make this ambiguous for a future reviewer.

## Acceptance-criteria coverage

All nine acceptance criteria are met, each verified by running its named automated check:

1. Unresolvable `context_exceptions[].decision` is a `validate` error — met.
   `validateContextExceptions` (`tools/specs/validation.mjs:166`) rejects it; covered by
   `describe('validateContextExceptions (D13, AC1)')` in `tools/tests/validation.test.mjs`
   (7 tests, all pass).
2. A valid `context_exceptions` entry changes `computeTaskFingerprint`'s output for that
   task and no other — met. Covered by
   `describe('computeTaskFingerprint — context_exceptions is part of the projection (AC2)')`
   (1 test, pass).
3. `consequential_paths`/`forbidden_paths` overlap is a `validate` error naming the glob —
   met. `validateConsequentialPaths` (`tools/specs/validation.mjs:188`) names both globs;
   covered by `describe('validateConsequentialPaths (AC3)')` (4 tests, pass).
4. `follow-ups.yaml` entries are mutated in place, never appended — met.
   `resolveFollowUp` (`tools/specs/service.mjs:305`) edits the existing entry; covered by
   `describe('addFollowUp / resolveFollowUp — mutable in place, never append-only (AC4)')`
   (3 tests, pass).
5. Dismissing a `blocking` entry without a referenced owner decision is rejected — met,
   and hardened beyond the original text: a structured `decision_ref` field is now
   required (not a regex scan of free-form `resolution` prose), and a superseded decision
   is rejected too, naming the replacement. Covered by
   `describe('validateFollowUps — dismissing a blocking entry requires a recorded owner decision (AC5, ...)')`
   (7 tests, pass).
6. A stale `resolver_task` reference is detected — met. Covered by
   `describe('validateFollowUps — stale resolver_task (AC6)')` (4 tests, pass).
7. `spec-finalize` blocks on an open, `blocking`-severity follow-up entry — met.
   `validateFinalize` (`tools/specs/lifecycle.mjs:861`) implements the gate; covered by
   `describe('validateFinalize — blocks on an open, blocking-severity follow-up (AC7)')`
   in `tools/tests/follow-ups.test.mjs` (3 tests, pass).
8. `templates/task.md` documents the per-criterion evidence tag syntax — met by
   inspection: the "## Acceptance criteria" section documents `automated:`/`inspection:`/
   `owner-decision:` tags with examples.
9. Malformed `follow-ups.yaml` fails `validate` with a specific reason — met. Covered by
   `describe('validateFollowUps — malformed content (AC9)')` (7 tests, pass), including
   the PR-review-packet-05B fix for a present file with no `follow_ups` key at all.

## Architecture and documentation

No ADR or `docs/development/` conflict found — this task's diff never touches
`docs/development/**` (correctly, it's in `forbidden_paths`). Documentation impact per
the task file (`templates/task.md`, `task-review.md`, `spec-audit.md`, `spec-finalize.md`)
is three-quarters complete: `templates/task.md`, `spec-audit.md`, and `spec-finalize.md`
each carry the required update (verified by reading current content); `task-review.md`
carries the "record as follow-up" step 7a but not the `consequential_paths` scope-check
update the task's own "Implementation constraints" section explicitly calls for — see F1.

## Tests

Every acceptance criterion above is backed by an automated test, and every behavior
change this task introduces (`context_exceptions`, `consequential_paths` overlap,
mutable follow-up ledger, `decision_ref`-gated dismissal, `spec-finalize` blocking check)
has direct test coverage. No behavior change without a corresponding test was found.

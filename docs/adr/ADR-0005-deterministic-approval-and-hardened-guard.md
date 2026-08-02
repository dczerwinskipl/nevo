---
id: adr.0005-deterministic-approval-and-hardened-guard
type: adr
title: Make task approval deterministic and CLI-enforced; replace the Bash guard's regex allowlist with an explicit, whitelist-only validator
status: accepted
date: 2026-08-02
supersedes: ~
superseded_by: ~
---

# ADR-0005: Make task approval deterministic and CLI-enforced; replace the Bash guard's regex allowlist with an explicit, whitelist-only validator

## Status

Accepted

## Context

PR #13 (the branch carrying [ADR-0004](ADR-0004-review-artifacts-and-handoff.md)'s
review-artifact work) drew GitHub Copilot review comments plus a detailed owner
work order after manual review, both converging on the same root problem: several
guarantees the workflow *documented* were not actually *enforced* by code.

Concretely:

1. **`tools/specs.mjs approve`** changed a task's status to `approved` from any
   non-terminal, non-in-implementation status — `blocked` and `needs-decision` could
   be "approved" just as easily as `draft` (Copilot, `tools/specs.mjs:412`). No
   command validated status transitions against a single source of truth; `complete`
   and `verify` didn't check the *current* status at all before overwriting it.
2. **Approval readiness was never independently verified.** `approve` trusted
   whatever the agent claimed about a review's verdict in conversation — there was no
   check that a review file even existed, that its verdict was actually
   `ready-for-approval`, that it had no unresolved findings, or that it still matched
   the current specification (a review written five edits ago could still "count").
3. **The researcher's Bash guard used regex allowlists shaped like `command +
   arbitrary trailing arguments`** (e.g. `^git diff(\s+\S+)*$`) — technically
   "read-only" commands, but `git diff`/`git log`/`git show` all support
   `--output=<file>`/`-o`, which write files. The guard's own design let exactly the
   class of thing it claimed to prevent through, because it recognized commands by
   name rather than validating their actual arguments.
4. **The chat-facing verdict summary was a single dense line**
   (`Status: changes-required ready_for_approval: false · ...`) — technically
   complete, but hard to scan and rendered poorly in Markdown-capable clients (Claude
   Code extension, VS Code).
5. Two smaller, concrete inconsistencies: `task-review`'s re-review baseline sentence
   said "current specification" when the command reviews a task implementation, not a
   spec (Copilot); and `spec-approve`'s closing summary said `Artifact: none` while the
   command does mutate `change.yaml` (Copilot).

## Decision

1. **A single, exported state-machine table** (`TRANSITIONS` in `tools/specs.mjs`)
   defines exactly `draft → approved → in-implementation → implemented → verified`.
   `validateTransition(command, currentStatus)` is the one place every mutating
   command (`approve`, `start`, `complete`, `verify`) checks its precondition — no
   command assigns a status without going through it. Re-running a command when the
   task is already at the target status is a documented, safe no-op (idempotent);
   every other mismatch is a hard rejection with a message naming the required status.
2. **A deterministic spec fingerprint** (`computeSpecFingerprint` /
   `node tools/specs.mjs fingerprint <change>`): a sha256 hash over the
   specification's approval-relevant inputs (manifest, overview, owner decisions,
   every area/task file — sorted for determinism), excluding `reviews/**` so writing
   the review can never invalidate its own fingerprint. `/nevo-ai:spec-review` embeds
   this exact printed value in the review's `spec_fingerprint` front matter; an LLM
   never computes or estimates the hash itself, since that would not be deterministic.
3. **`validateApproval` centralizes the full approval gate** as a pure, exported,
   independently testable function: task must be exactly `draft` (idempotent if
   already `approved`); a review file must exist; its verdict must be
   `ready-for-approval`; `unresolved_required_fixes`, `unresolved_owner_decisions`,
   and `unresolved_needs_clarification` (now three separate counts, not one merged
   figure) must all be zero; and its `spec_fingerprint` must match a freshly computed
   one. `/nevo-ai:spec-approve` became a thin wrapper around this — the CLI enforces
   the gate, not the agent's judgment. The command's menu was also cut from four
   options to three (approve / keep as draft / show report); "approve and start
   implementation" as a single combined action was removed entirely — approving a
   task and starting it are always two separate, separately-confirmed steps.
4. **The Bash guard was rewritten from regex-per-command to a tokenizer plus an
   explicit, per-subcommand flag whitelist** (`validateCommand`, exported as a pure
   function). A flag or positional argument must be on the list to be allowed;
   `--output`, `-o`, `--output=<path>`, and any other file-writing option are rejected
   simply by never appearing on any allowlist — the guard does not need to specifically
   recognize them as dangerous. Positional arguments must match a safe ref/path
   pattern and never begin with `-`, so a disguised flag can't pass as an argument.
5. **The chat-facing summary is now structured Markdown**, not a dense line: headed
   sections, bold labels, a bulleted field list, and the next command in its own fenced
   block. `/nevo-ai:spec-review` has an exact required template (verdict, three
   separate unresolved counts, a `Required action` section, `Report`, `Next command`);
   other commands follow the same spirit adapted to their own fields. Defined once in
   `references/review-policy.md` § "Chat output shape" (spec/task review) and
   `SKILL.md` § "Ending every command's response" (the other five commands); no
   command file restates the template.
6. Both smaller inconsistencies were corrected at the source: `task-review`'s baseline
   sentence now says "current task implementation"; `spec-approve`'s `Artifact` field
   now names the `change.yaml` status transition instead of claiming `none`.
7. **Restructured `tools/specs.mjs` and `tools/docs.mjs` for testability**: the CLI
   dispatch (the `switch` on `process.argv`, including its `process.exit()` calls) is
   now guarded behind an "is this the directly-executed module" check, so the parser,
   transition, fingerprint, and approval-gate logic can be `import`ed by tests without
   triggering CLI side effects. `tools/tests/*.test.mjs` (Node's built-in `node:test`,
   zero new dependencies) covers the parser, the state machine, the fingerprint, the
   approval gate, and the Bash guard as pure functions, plus a small set of real
   spawned-process CLI smoke tests for the success/failure paths that matter most.

## What was deliberately not adopted / not changed

- Inline `{}` support, added defensively alongside the `[]` fix in the previous PR, was
  removed from both YAML-subset parsers — a repository-wide search found no schema
  field that uses it. `[]` stays, since it fixes a real, demonstrated bug
  (`required: []`). The custom parser only grows to meet a demonstrated need, per the
  same anti-over-engineering stance as ADR-0003/0004.
- Verdict logic, task-status semantics, and review classification were **not** changed
  as part of the chat-output formatting fix — only how the same fields are displayed.
- The Bash guard's allowlist stays intentionally small (six `git` subcommands, `dotnet
  sln list`, and the already-existing `docs.mjs`/`specs.mjs` read-only subcommands) —
  broadening it to cover every conceivable safe git invocation was explicitly not
  attempted; the guard is meant to cover the researcher's actual documented needs, not
  to be a general-purpose git-command sandbox.

## Consequences

- `approve`, `start`, `complete`, and `verify` now reject an out-of-sequence transition
  with a specific, actionable message instead of silently accepting it — a behavior
  change from before, where `complete`/`verify` didn't check current status at all.
- A specification review is now a hard prerequisite for approval, verified against the
  actual current file contents via the fingerprint — an agent (or a human) can no
  longer approve a task on the strength of a stale or merely-claimed review.
- `tools/specs.mjs` and `tools/docs.mjs` gained real, if minimal, automated test
  coverage for the first time in this repository — `node --test tools/tests/`, no new
  dependency, documented in `docs/development/testing.md`.
- The Bash guard's allowlist is now visibly small and explicit rather than
  "command name + whatever arguments" — extending it for a new legitimate need means
  adding an explicit flag to a table, not loosening a regex.
- Slightly more code in `tools/specs.mjs` (the state machine, fingerprinting, and
  approval-gate logic) and a new `tools/tests/` directory; judged proportionate given
  every item fixes a concretely identified gap between documented and enforced
  behavior, not speculative hardening.

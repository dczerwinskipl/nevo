---
review-of: spec
change: ai-sessions-live-chat-integration
generated: 2026-08-15
verdict: ready-for-approval
ready_for_approval: true
implementation_allowed: false
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
spec_fingerprint: 5a0611d3a6de1c668e11bd5e4f04b311bb07c237d440973eeb8c6f7fad67faca
task_fingerprints:
  stable-spec-identity-and-backfill: 9912b8c68a5d95f116ec0864b9e8816450f0fb533c2b6da04f50c8f5117cb6b9
  provider-neutral-ai-contracts: 8ec687996deb64a8a2318ca8b572bc2d8100ee383f37f3cc721444e7a8979b38
  interactive-turn-runtime: 9d3bb24eb0df551d415e4189e95d4e14e24c00799f2cfc70d85663586cb5d0a2
  mock-ai-adapter-and-demo-data: c0831865787e7623adad2e400f9c78148c50497ef95c9b96276b81640f7440a4
  ai-session-http-and-sse-api: 70ec2fd2ad8de56ed4f1f91362ba6d2f7303316c0bf3ae92cb2213013e0c672e
  session-navigation-and-context-surfaces: 6a6fbc9a219d52cbbada10576edb48b07ea27f0c1be7d721e29a616d53e8604c
  fullscreen-chat-and-session-creation: 4773d76eb90048e23e5b80c653befc3d684f1f33c29be584c559ea3029c48828
  part1-integration-verification-and-docs: efdfa22ae93ea9ce6f67afc529c761fdf583a2b32b9b7d96538890463199c5a6
  claude-readiness-discovery: 7d32b42d8d950e47e9c2b3574f67b3c288fcc528e716117ed4603b3991b3d050
  local-ai-registry-and-manual-attach: 862b5f2b4dda2e1f526d47db0fedc84dde54650e0d0bc3576260bd55d8caa320
  ai-session-context-cli-preflight: a0e5e478b9ab08a056791b10aab6e6c13a9a016a9c96fe3af65777baa50ffff3
  claude-hooks-and-invocation-context: da61fa946b4f8e9b2aa77b8d1bdbaeee4331e3855bc68abf57387b154f371ef8
  claude-session-adapter: 8a97c9bdd367032421c3e78497090d7316abf06485818d0d3c64019a29024588
  claude-live-chat-e2e-and-docs: a6af6bccc31fece27523121b50734b7be59884dab7f7e46a7950c0dd46d958ab
---

Re-review (2026-08-15, `--all`). Baseline: this file's prior content (`ready-for-approval`,
spec_fingerprint `90a8939d...`). The prior review predates the owner's PR #25 review
(commit e6496d5) of the specification itself. Re-read `overview.md`, all five `areas/`
files, all 14 `tasks/`, and `owner-decisions.md` fresh for this run.

Applied since the prior review (owner-driven, recorded as D10-D13): C20 (at most one
non-terminal turn per session, plus an optional start-turn idempotency key), C9 extended
(question correlation by stable `id`, never by prose; permission `input` is
adapter-normalized/bounded/sanitized, never a raw provider payload), and C2 tightened
(`validate`/`check` requires `spec_id` once backfill has run — implemented directly in
`tools/specs/validation.mjs`, since task 01 was already complete when this was raised).

Semantic-reference completeness (D26/D29) surfaced two gaps while re-reading the affected
tasks, both closed before writing this report (`AUTO_FIX`, applied — task-review's
"the agent may make this fix without further deliberation" standard, same as any other
`AUTO_FIX`):

- Tasks 01/03/05 implement D13/D10 directly in their own acceptance criteria and
  implementation constraints but didn't list them in `semantic_references.decisions`
  (only the corresponding constraint was listed) — added, matching this document's own
  existing decision-plus-constraint pairing convention (e.g. task 03's pre-existing
  `D4, D5` alongside `C9-C12`).
- Point 3 of the owner's review (permission `input` normalization, folded into C9) had no
  task-level acceptance criterion anywhere — no task actually tested that an adapter
  produces a bounded/sanitized `input` rather than a raw passthrough. Added task 04
  (`mock-ai-adapter-and-demo-data`) AC6 and a matching implementation constraint, since
  `MockAiAdapter` is the concrete adapter that must prove this is achievable; referenced
  D12 in its `semantic_references.decisions`.

No other blocking issues, ambiguity, architecture conflict, task-decomposition problem, or
documentation/ADR gap found. `node tools/specs.mjs validate` and `node tools/docs.mjs
validate` (gating) both pass. `node tools/specs.mjs check` and `node tools/docs.mjs check`
(non-gating, repository-wide) both pass — indexes were regenerated as part of this run.

# Review: ai-sessions-live-chat-integration

- [x] No unresolved required fix
- [x] No unresolved owner decision
- [x] No unresolved clarification request
- [x] Verdict: ready-for-approval

## Implementation readiness

- May implementation start now? Yes.
- Are the relevant tasks `approved` in `change.yaml`? No — every task is currently
  `draft` except `stable-spec-identity-and-backfill`, which is `implemented`.
- What has to happen first? Nothing — ready. Approve the desired Part 1 task(s)
  (`provider-neutral-ai-contracts` through `part1-integration-verification-and-docs`)
  to unlock implementation.

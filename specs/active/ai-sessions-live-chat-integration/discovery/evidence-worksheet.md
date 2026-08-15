# Task 09 discovery — evidence worksheet (working notes, not the final report)

Working scratchpad for `claude-readiness-discovery`. The final, sanitized report goes in
`discovery/claude-readiness.md` once enough evidence is collected. Raw output goes under
ignored `.nevo-ai-local/discovery-raw/` — confirmed ignored via
`git check-ignore .nevo-ai-local/probe` (exit 0) before any raw evidence is written.

## Confirmed so far (this environment, 2026-08-15)

- `claude --version` → `2.1.220 (Claude Code)`. `claude doctor` → native install,
  `C:\Users\domin\.local\bin\claude.exe`, no installation issues, auto-updates enabled.
- `claude auth status` → logged in via `claude.ai` OAuth, `apiProvider: firstParty`,
  `subscriptionType: pro`. (Raw output, including email/orgId, stays local-only —
  never copy it into the committed report.)
- Per official docs (`code.claude.com/docs/en/headless`, fetched live): the CLI's
  `-p`/headless mode **is** one of the three documented Agent SDK surfaces (the other
  two are the Python and TypeScript packages) — "CLI vs Agent SDK" is really "shell out
  to `claude -p`" vs. "import `@anthropic-ai/claude-agent-sdk` and call `query()`/use
  `ClaudeSDKClient`", not two unrelated systems.
- Per official docs (`code.claude.com/docs/en/agent-sdk/permissions`, `.../hooks`): 33
  hook events are documented to fire consistently across CLI/terminal, VS Code, Desktop,
  and Claude Code on the web (remote/cloud sessions don't read local
  `~/.claude/settings.json` — only project `.claude/settings.json` and org-managed
  settings). Every hook receives `session_id`, `transcript_path`, `cwd`,
  `permission_mode`, `hook_event_name` on stdin — `session_id` is the likely canonical
  ID for task 12's invocation-context bridge.
- **Architecture question, narrowed by inspecting the real SDK type declarations**
  (scratch `npm install @anthropic-ai/claude-agent-sdk` in a throwaway directory
  outside the repo — package metadata only, no API calls made, so no cost incurred;
  license is Anthropic's Commercial Terms of Service, same terms this environment's
  Claude subscription already operates under, not a separate paid license; 8.85M
  weekly downloads per the npm registry API on 2026-08-15 — well clear of "low
  downloads"). The installed `sdk.d.ts` documents a real wire-level JSON control
  protocol (`SDKControlRequest` / `type: 'control_request'`, subtype `can_use_tool`,
  with `tool_name`/`input`/`decision_reason` fields) that a caller resolves with a
  `PermissionResult` (`{behavior:'allow', updatedInput?, ...}` or `{behavior:'deny',
  message}`) — the SDK's own doc comment says permission prompts have **no park
  deadline** (can block indefinitely), which is exactly what C9/D4 need. Critically,
  one comment (`sdk.d.ts` near `SDKPermissionDeniedMessage`) states explicitly:
  *"Without one \[a permission prompt surface\] (bare -p / SDK query() with no
  canUseTool), 'ask' decisions are terminal"* — i.e. **the bare CLI in plain `-p` mode
  auto-denies anything needing a permission decision; it does not pause.** Whether the
  raw CLI *can* still speak this `can_use_tool` control-request protocol directly over
  `--input-format stream-json --output-format stream-json` (no npm package at all,
  zero new dependency) is the one still-unconfirmed, decisive fact — see Batch 2 below,
  now redesigned around this specific question instead of a vague permission probe.
  If the raw CLI does *not* expose this over plain stdio, the real adapter (task 13)
  needs the TypeScript Agent SDK package as a new dependency — a **C18 owner-decision**
  to flag explicitly, not something this task resolves silently. (Owner note,
  2026-08-15: pre-authorized free/commercially-usable, non-obscure npm libraries for
  this discovery — this package clears that bar per the above.)

## Evidence batches for the owner to run

Raw output only — never paste secrets/emails/org IDs into the committed report.

### Batch 1 — CLI session lifecycle (cheap, ~5 short calls)

```bash
mkdir -p .nevo-ai-local/discovery-raw

claude -p "Reply with exactly: PONG" --output-format json > .nevo-ai-local/discovery-raw/01-create.json

SESSION_ID=$(node -pe "JSON.parse(require('fs').readFileSync('.nevo-ai-local/discovery-raw/01-create.json','utf8')).session_id")
echo "session_id=$SESSION_ID"

claude -p "What word did you just say?" --resume "$SESSION_ID" --output-format json > .nevo-ai-local/discovery-raw/02-resume.json

claude -p "Count from 1 to 5, one number per message." --output-format stream-json --verbose --include-partial-messages > .nevo-ai-local/discovery-raw/03-stream.jsonl

claude -p "Session Alpha marker, reply with exactly ALPHA-DONE." --output-format json > .nevo-ai-local/discovery-raw/04a-concurrent.json &
claude -p "Session Beta marker, reply with exactly BETA-DONE." --output-format json > .nevo-ai-local/discovery-raw/04b-concurrent.json &
wait
```

Tells us: canonical `session_id` field name/shape, whether resume actually recalls
context, what a stream-json event sequence looks like, whether two concurrent CLI
invocations register/complete independently.

### Batch 2 — the decisive test: does the raw CLI expose `can_use_tool` over plain stdio?

```bash
echo '{"type":"user","message":{"role":"user","content":"Run the shell command: echo permission-test-marker"},"parent_tool_use_id":null}' | claude -p --input-format stream-json --output-format stream-json --permission-mode default --verbose > .nevo-ai-local/discovery-raw/05-permission-raw-cli.jsonl
```

Look for a line with `"type":"control_request"` and `"subtype":"can_use_tool"` in the
output. If present → the raw CLI itself speaks the protocol, no new dependency needed.
If absent (an auto-deny / `permission_denied` event instead, and `echo
permission-test-marker` never actually ran) → confirms the bare CLI auto-denies and
the SDK package is genuinely required for task 13.

### Batch 3 — only if Batch 2 shows the raw CLI auto-denies

A minimal, type-verified TypeScript script using `query()` with a real `canUseTool`
callback (verified against the installed package's actual `.d.ts`, not doc prose) to
confirm the SDK path really pauses/resumes. I'll provide it if Batch 2 comes back
negative.

## Still needed (real evidence, no shortcut)

- VS Code extension: does a hook actually fire there, same events/payload shape?
- Remote Control (claude.ai / mobile app): pairing, identity, hook behavior.
- Real permission/`AskUserQuestion` resolution via whichever mechanism batch 2/3 prove
  out.
- Required local config fields once the transport is selected.

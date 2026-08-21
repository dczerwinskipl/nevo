---
id: chat-ux-improvements-pt1.tool-activity-normalization-and-details
status: draft
change: chat-ux-improvements-pt1
depends_on: [semantic-chat-presentation-model, per-turn-work-presentation]
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - docs/development/react-component-guidelines.md
    - specs/active/chat-ux-improvements-pt1/areas/react-component-guidelines.md
    - tools/dashboard/src/components/ai-tool-view.tsx
    - tools/dashboard/src/lib/types.ts
  optional:
    - specs/active/ux-improvements-version-1/tasks/04-mode-description-tooltip.md
allowed_paths:
  - tools/dashboard/src/lib/tool-activity-labels.ts
  - tools/dashboard/src/components/ai-tool-view.tsx
  - tools/dashboard/src/components/work/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/ai/**
  - tools/dashboard/server/**
---

# Task: Normalize and redesign tool activity/details

## Goal

Make tool activity human-readable without losing technical transparency (FR-5/FR-6).
Today `AiToolView` (`ai-tool-view.tsx:10-90`) shows the raw `toolCall.name` and an
uppercase-styled status badge (`ai-tool-view.tsx:37-46`) as the primary label — the
opposite of the desired hierarchy where the activity's meaning is primary and status is
secondary.

## Implementation constraints

- Add a deterministic, frontend-only label-lookup module
  (`tools/dashboard/src/lib/tool-activity-labels.ts`) keyed on `toolName` +
  structured `input` fields already available client-side (e.g. `input.command`,
  `input.path`) — mirroring the pattern `ux-improvements-version-1`'s
  `mode-description-tooltip` task establishes for mode metadata
  (`tools/dashboard/src/lib/ai-mode-meta.ts`, single source of truth for a label
  lookup consumed by more than one component). No backend/adapter change is needed:
  `AgentToolCall.input`/`toolName` are already delivered to the frontend
  (`tools/dashboard/src/lib/types.ts:374-381`).
- No extra LLM call for label generation (FR-5, explicit non-goal) — purely
  deterministic string derivation from structured data, with a sane fallback (e.g.
  "Running command") when no specific mapping exists for a tool/command.
- Status is visually secondary to the activity label (reverse of today's uppercase
  badge-as-primary treatment).
- Preserve the existing input/output expand pattern (`ai-tool-view.tsx:63-87`); large
  payloads stay capped/scrollable (`max-h-48 overflow-auto` today) rather than
  overflowing on mobile.
- Per `owner-decisions.md` D6 (open as of this writing — this task consumes whatever
  fix Task 01 lands, it does not re-derive tool terminal status from raw events): the
  detail view for a tool call Task 01's projection marks as not-successfully-completed
  must reflect that corrected status, never "completed" regardless of how the turn
  actually ended.
- Technical tool type (`toolCall.name`) remains discoverable even once a friendlier
  label is primary — do not hide it entirely, demote it visually.

## Acceptance criteria

1. When a meaningful description already exists in structured data, it is used as the
   primary label.
   `inspection: verify a tool call carrying a descriptive input (e.g. a file path) renders a specific label, not the raw tool name`
2. When no such description exists, a deterministically derived label is shown instead
   of the raw tool name; unmapped tools fall back to a generic but still human label
   (e.g. "Running command"), never a blank/undefined label.
   `automated: npm --prefix tools/dashboard test`
3. No new LLM call is introduced for label generation.
   `inspection: read the label module, confirm no network/model call`
4. Technical tool type remains discoverable (e.g. in the expanded detail view).
   `inspection: expand a Work item, confirm the raw tool name is still visible`
5. Status is visually secondary to the activity label.
   `inspection: compare visual weight of label vs. status badge before/after`
6. Input/output/errors remain inspectable; large payloads remain usable on mobile
   (capped/scrollable, no unbounded overflow).
   `inspection: expand a tool call with a large output at a narrow viewport`
7. A tool call Task 01 marked as not-successfully-completed (abrupt termination) shows
   that corrected status in its detail view, not "completed".
   `automated: npm --prefix tools/dashboard test`
8. Label normalization has focused unit tests for at least: `Read` with a path,
   `Bash` with a known vs. unknown command, and a tool with no useful structured
   input (fallback case).
   `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Adding new tool/event types or provider capability.
- Any backend/adapter change — this task is confirmed frontend-only per discovery.

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
    - tools/dashboard/src/components/ai-tool-view.tsx
    - tools/dashboard/src/lib/types.ts
  optional:
    - specs/active/ux-improvements-version-1/tasks/04-mode-description-tooltip.md
semantic_references:
  decisions: [D6]
  dependency_contracts: [semantic-chat-presentation-model, per-turn-work-presentation]
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
- **Presentation precedence (explicit, three tiers, checked in order):**
  1. An existing meaningful structured description already supplied with the tool
     input/event (e.g. an `input.description`-shaped field), when present — use it
     verbatim, do not discard a good provider/tool-supplied description only to
     synthesize another one. (Note: no current adapter/tool populates such a field as
     of this writing — `grep` across `tools/ai/*.mjs`/`contracts.mjs` found no
     `description` field on any tool-call input shape — so this tier is a
     forward-compatible precedence rule, not dead code for a case that can't occur;
     tier 2 is what actually fires for every tool today.)
  2. Deterministic Nevo normalization from structured data already available
     client-side (file path, command, query, etc.) — the `tool-activity-labels.ts`
     lookup this task builds.
  3. A generic deterministic fallback (e.g. "Running command", "Reading file") when
     neither tier 1 nor tier 2 produces anything.
- No extra LLM call for label generation at any tier (FR-5, explicit non-goal) —
  purely deterministic string derivation from structured data.
- Status is visually secondary to the activity label (reverse of today's uppercase
  badge-as-primary treatment).
- Preserve the existing input/output expand pattern (`ai-tool-view.tsx:63-87`); large
  payloads stay capped/scrollable (`max-h-48 overflow-auto` today) rather than
  overflowing on mobile.
- Per `owner-decisions.md` D6 (decided Option A — this task consumes the fix Task 01
  implements, it does not re-derive tool terminal status from raw events): the detail
  view for a tool call Task 01's projection marks `status: 'failed'` must reflect that
  status, never "completed", regardless of how the turn actually ended.
- Technical tool type (`toolCall.name`) remains discoverable even once a friendlier
  label is primary — do not hide it entirely, demote it visually.
- **Single source of truth for every primary user-facing activity label (corrected
  during a follow-up review of PR #35).** `tool-activity-labels.ts`'s `activityLabelFor`
  is not only `AiToolView`'s label source — it is the one normalization path for **every**
  place a tool's activity is shown as the primary label, including Task 03's per-turn
  Work "current activity" line (`components/work/**`, in this task's own
  `allowed_paths`). A raw provider tool name (`Read`, `Bash`, `Edit`, ...) must never
  appear as a primary label anywhere in the transcript; normalization logic is never
  duplicated into a second implementation for a different call site.

## Acceptance criteria

1. **Tier 1 wins when present:** a tool call carrying an existing structured
   description (e.g. `input.description`) renders that description verbatim as the
   primary label — it is never discarded in favor of a synthesized tier-2/3 label.
   `automated: npm --prefix tools/dashboard test`
2. **Tier 2 fires when tier 1 is absent:** a tool call with useful structured input
   but no explicit description (the case every current tool hits) renders a
   deterministically derived label instead of the raw tool name.
   `automated: npm --prefix tools/dashboard test`
3. **Tier 3 fires when neither tier 1 nor 2 applies:** an unmapped tool with no useful
   structured input falls back to a generic but still human label (e.g. "Running
   command"), never a blank/undefined label.
   `automated: npm --prefix tools/dashboard test`
4. No new LLM call is introduced for label generation, at any tier.
   `inspection: read the label module, confirm no network/model call`
5. Technical tool type (`toolCall.name`) remains discoverable (e.g. in the expanded
   detail view) as secondary/debug information, regardless of which tier produced the
   primary label.
   `inspection: expand a Work item, confirm the raw tool name is still visible`
6. Status is visually secondary to the activity label.
   `inspection: compare visual weight of label vs. status badge before/after`
7. Input/output/errors remain inspectable; large payloads remain usable on mobile
   (capped/scrollable, no unbounded overflow).
   `inspection: expand a tool call with a large output at a narrow viewport`
8. A tool call Task 01 marked as not-successfully-completed (abrupt termination) shows
   that corrected status in its detail view, not "completed".
   `automated: npm --prefix tools/dashboard test`
9. Label normalization has focused unit tests for at least: a tool call carrying an
   explicit structured description (tier 1 wins over tier 2 even when tier 2 could
   also produce a label); `Read` with a path and `Bash` with a known command (tier 2);
   `Bash` with an unknown command and a tool with no useful structured input (tier 3
   fallback).
   `automated: npm --prefix tools/dashboard test`
10. **(New)** Task 03's per-turn Work "current activity" line renders through
    `activityLabelFor`, never the raw provider tool name — the same normalization path
    `AiToolView` uses, not a second implementation.
    `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Adding new tool/event types or provider capability.
- Any backend/adapter change — this task is confirmed frontend-only per discovery.

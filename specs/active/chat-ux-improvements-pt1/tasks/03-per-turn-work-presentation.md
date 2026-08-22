---
id: chat-ux-improvements-pt1.per-turn-work-presentation
status: draft
change: chat-ux-improvements-pt1
depends_on: [semantic-chat-presentation-model]
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/src/components/ai-chat.tsx
    - tools/dashboard/src/components/ai-tool-view.tsx
    - tools/dashboard/src/lib/nevo-assistant-runtime.ts
    - tools/dashboard/src/lib/types.ts
  optional:
    - specs/active/chat-ux-improvements-pt1/tasks/01-semantic-chat-presentation-model.md
semantic_references:
  decisions: [D6, D9]
  dependency_contracts: [semantic-chat-presentation-model]
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/ai-tool-view.tsx
  - tools/dashboard/src/components/work/**
  - tools/dashboard/src/components/ui/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/ai/**
  - tools/dashboard/server/**
---

# Task: Introduce per-turn Work presentation

## Goal

Replace one-card-per-tool-call rendering with compact Work, consuming Task 01's
Conversation/Work projection. Today, `message.toolCalls?.map(...)` renders one
independent `AiToolView` card per call (`ai-chat.tsx:62-64`) with no grouping — a
12-tool turn produces 12 full-size cards.

## Implementation constraints

This task's contract was corrected during a follow-up review of PR #35's first
implementation pass, which found Work rendered more than once for the same turn, nested
inside an unnecessary card, and terminated prematurely by an earlier failed action. The
corrected contract below supersedes the original framing wherever the two differ —
notably AC5 (a failed action's individual visibility) and the ownership model (points 1-9
below).

- **Ownership: Work is per-turn, not per-message-chunk.** A turn represents its tool
  activity as exactly one Work group, and the transcript renders **at most one** `Work`
  summary for that turn — never once per assistant message/prose segment that happens to
  share the turn. A turn may produce multiple assistant messages (e.g. when the provider
  emits distinct `messageId` values for separate content segments); Work is anchored at
  exactly one deterministic position for that turn (the `TurnWork.messageId` field
  produced by the projection — the first message in transcript order with tool calls or
  a `turnError`) and is never repeated alongside each segment. The rendering layer uses
  `TurnWork.messageId` to decide which message owns the Work row; all other messages for
  the same turn render prose only.
- Build a new `WorkSummary` component (module-level, per
  `docs/development/react-component-guidelines.md` §20.1) consuming Task 01's per-turn
  Work view-model — do not re-derive current/completed/failed grouping inside this
  component's JSX (§6, §9.2: the projection already did that work in Task 01).
- **Lifecycle and outcome are independent (corrected).** A turn's Work group stays
  `current` for as long as the turn itself is active (not yet terminal) or has any
  action still `running` — **regardless of whether an earlier action in it already
  failed.** A valid active turn can look like `Read failed`, `Bash completed`, `Edit
  running` while the agent keeps working; it must not be forced into a terminal
  `'failed'` state merely because one historical action failed. Whether any action in
  the group has failed (`hasFailures`/"requires attention") is a separate, orthogonal
  signal from lifecycle — both are exposed by Task 01's projection and consumed here,
  never re-derived.
- Running state: one current activity as the primary line, normalized per Task 04 (see
  Task 04's own requirement — this task must not render the raw provider tool name);
  previously-completed activity summarized compactly (a lightweight count row, not
  individual cards — see the collapsed-presentation point below); new current activity
  replaces the previous one (does not grow the transcript indefinitely). If an earlier
  action in the still-active turn already failed, the compact prior-actions row reflects
  that (attention indicator), without changing the turn's `current` lifecycle.
- Terminal state (completed or failed): the group collapses to one compact summary row
  (e.g. "Work · 8 actions ✓", or "Work · 8 actions · requires attention" when
  `hasFailures`), expandable to inspect individual actions via the existing `AiToolView`
  expand pattern.
- **Collapsed Work never emits historical action cards, failed or not (corrected).** A
  failed action's status is retained and it becomes individually inspectable once Work is
  expanded — this is what "remains individually inspectable" means. It does **not** mean
  a failed action renders as a separate card outside the collapsed row while Work is
  still collapsed; collapsed Work is always exactly one row regardless of how many
  actions (or failures) it contains.
- Do not invent new provider states beyond what Task 01's projection already
  distinguishes (FR-4). Turn/Work Outcome (successful/failed/cancelled) is a distinct
  concept from per-tool status — see `owner-decisions.md` D9; this component displays
  whichever of the two Task 01 actually exposes for a given activity, it does not
  blend them.
- Work associates with the relevant assistant turn per Task 01's documented
  correlation (explicit `turnId`, never derived by parsing message text or `id`
  conventions) — do not merge Work from unrelated turns, and never let a terminal event
  for one turn affect another turn's still-`running` actions (see Task 01's
  turn-scoped cleanup).
- **Presentation is flat, not nested (corrected).** A turn segment with no assistant
  prose (Work-only) renders Work directly in the transcript — no assistant message
  card, no empty prose bubble, no empty placeholder/avatar-only row, no artificial
  padding around Work. When assistant prose exists, it renders with its normal message
  styling; Work never sits nested inside that prose card, and prose never duplicates the
  turn's one Work summary. The collapsed Work row itself is a lightweight transcript/
  activity row (icon + label + count + expand affordance) — it does not require a large
  rounded container, message-like background, or prominent border; it should read as
  metadata about the turn, not as another chat bubble.
- View-model update boundaries: the "current activity" line updates frequently during
  streaming; the "N completed" summary changes far less often. Per
  `docs/development/react-component-guidelines.md` §9.1, do not force both into one
  object that both a low-frequency summary consumer and a high-frequency
  current-activity consumer subscribe to identically if it causes avoidable re-renders
  of the collapsed summary on every token (in particular, any callback/handler passed to
  the low-frequency consumer must stay referentially stable across renders).

## Acceptance criteria

1. A turn producing multiple successful tool calls renders as one compact Work
   summary, not one card per call.
   `inspection: run/simulate a turn with 5+ successful tool calls, confirm one Work row, not five cards`
2. While running, one current activity is the primary visible line, using Task 04's
   normalized label (never the raw provider tool name); prior completed activity is
   compact; a new tool replaces the current slot rather than appending another full
   card.
   `automated: npm --prefix tools/dashboard test`
3. Completed Work is expandable to inspect all individual actions.
   `automated: npm --prefix tools/dashboard test`
4. Collapsed state exposes a meaningful action count/status (e.g. "N actions").
   `inspection: verify the collapsed label reflects the actual count`
5. **(Corrected)** A failed action is visibly flagged in the collapsed summary
   (`hasFailures`/"requires attention") and its status is retained and individually
   inspectable once Work is expanded — but it never renders as a separate card outside
   the collapsed row while Work is still collapsed, whether the turn is active or
   terminal.
   `automated: npm --prefix tools/dashboard test`
6. Work from unrelated turns is not merged where Task 01's projection can distinguish
   them.
   `inspection: simulate two sequential turns each with tool calls, confirm two separate Work groups`
7. Dozens of successful tool events do not dominate the mobile transcript (matches
   brief Scenario A: 12 actions → ~1 compact Work row on mobile).
   `inspection: simulate 12 successful tool events, check the rendered height/row count at a narrow viewport`
8. **(New)** An active turn containing a mix of completed, failed, and running actions
   stays `current` (never forced to a terminal `'failed'` state by the earlier failure);
   `hasFailures` is retained; the running action remains the visible current activity.
   `automated: npm --prefix tools/dashboard test`
9. **(New)** For a single turn, at most one Work summary is ever rendered — never once
   per assistant message/prose segment sharing that turn — regardless of how many
   assistant message chunks or tool actions the turn produced.
   `automated: npm --prefix tools/dashboard test`
10. **(New)** A turn segment with no assistant prose renders Work directly in the
    transcript, without an assistant message card, empty bubble, or placeholder; a turn
    with genuinely no content yet (no prose, no Work) renders nothing.
    `automated: npm --prefix tools/dashboard test`
11. **(New)** Collapsed Work renders as a lightweight transcript row (no large rounded
    container, message-like background, or prominent border) — semantically distinct
    from an assistant chat bubble.
    `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Human-readable per-tool labels beyond the current-activity line — Task 04 owns the
  normalization module itself; this task only consumes it (see AC2).
- Scroll/streaming stability of the Work region — Task 08.

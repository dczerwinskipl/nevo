---
id: chat-ux-improvements-pt1.conversation-message-presentation
status: draft
change: chat-ux-improvements-pt1
depends_on: [semantic-chat-presentation-model]
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/chat-ux-improvements-pt1/owner-decisions.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/src/components/ai-chat.tsx
    - tools/dashboard/src/components/markdown-content.tsx
    - tools/dashboard/src/components/work/work-visibility.ts
    - tools/dashboard/src/lib/chat-projection.ts
    - tools/dashboard/src/lib/types.ts
  optional: []
semantic_references:
  dependency_contracts: [semantic-chat-presentation-model]
allowed_paths:
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/markdown-content.tsx
  - tools/dashboard/src/components/conversation/**
  - tools/dashboard/src/components/ui/**
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/ai/**
  - tools/dashboard/server/**
---

# Task: Redesign conversation message presentation

## Goal

Make the conversation readable and space-efficient per FR-2. `ChatMessage`
(`ai-chat.tsx:46-93`, module-level — already extracted above `AiChatPage`, which starts
at line 153) uses `Bot`/`User` icons in rounded boxes as avatars (`ai-chat.tsx:57-61,
86-90`), plain `whitespace-pre-wrap` for user text with no collapse behavior
(`ai-chat.tsx:78`), and role distinction via flex alignment (`justify-end`/`items-end`)
plus background color (`ai-chat.tsx:56,62,67-71`) — not color alone. Task 01's
projection output already flows through this same function via a `work?: TurnWork`
prop, `hasVisibleProse`/`shouldRenderChatMessage`
(`tools/dashboard/src/components/work/work-visibility.ts`), and
`work && <WorkSummary work={work} />` (`ai-chat.tsx:65`) — this redesign must preserve
that integration; it does not touch Work/tool rendering itself (Task 03's scope).

## Implementation constraints

- Per `docs/development/react-component-guidelines.md` §20.1, `ChatMessage` must become a
  module-level component (its own file under `tools/dashboard/src/components/
  conversation/`), not a nested function recreated on every `AiChatPage` render.
- Remove avatars entirely (FR-2) — reclaim the mobile width they consume.
- Role distinction must not rely on color alone (NFR-2) — use alignment/spacing/a
  textual or iconographic cue in addition to background color.
- Long user messages collapse to a preview by default with an explicit expand action;
  full content is preserved (never rewritten/truncated destructively); user can
  collapse again. Short messages remain naturally sized. Follow the existing
  expand/collapse pattern already used by `AiToolView` (`components/ai-tool-view.tsx:11,
  29-61`) and `AiReasoningView` (`components/ai-reasoning-view.tsx:16,22-33`) for
  interaction consistency, per `react-component-guidelines.md` §4 (reuse before
  creating).
- Assistant messages remain expanded by default; preserve existing `react-markdown`
  + `remark-gfm` rendering (`markdown-content.tsx`).
- Use design tokens already established by `ux-improvements-version-1`'s verified
  `design-tokens` task, not new one-off colors (`react-component-guidelines.md` §2.1).

## Acceptance criteria

1. User/assistant avatars are removed. `inspection: render the chat, confirm no avatar icon/image renders`
2. Mobile message width increases materially (bubble no longer competes with a fixed
   avatar column). `inspection: render at a narrow viewport, compare bubble width before/after`
3. Roles remain visually distinguishable without relying only on color.
   `inspection: verify with a grayscale/contrast check that user vs. assistant remains distinguishable`
4. Long user messages collapse by default; collapsed messages expose a clear expand
   action; expanding shows full original content; user can collapse again; short
   messages remain naturally sized. `automated: npm --prefix tools/dashboard test`
5. Assistant messages remain expanded by default. `inspection: confirm no collapse affordance appears on assistant messages`
6. Existing markdown/code rendering continues to work (headings, lists, code blocks,
   GFM tables). `automated: npm --prefix tools/dashboard test`
7. No horizontal overflow on supported mobile widths.
   `inspection: check at 320px/375px viewport widths with a long unbroken token (e.g. a URL) in a message`
8. `ChatMessage` is a module-level component, not defined inside `AiChatPage`.
   `inspection: read the component's definition site`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Tool/Work card rendering — Task 03.
- Header/composer changes — Tasks 05/07.

# Dashboard session experience

## Responsibility

Make AI sessions a first-class, addressable, mobile-first dashboard workflow using the provider-neutral backend contract.

## Current state

The React dashboard uses local state for active/archive mode, selected slug, details tabs, and task dialogs. It has no router dependency or session surface. The server already falls back to `index.html` for unknown non-API paths, so addressable SPA state can be added without a new routing package. React Query polls canonical dashboard data and invalidates it from coarse `/api/events` notifications.

## Requirements

- Show recent sessions high on active specification overview, before finalization controls.
- Derive current/completed groups from status while preserving global `lastActivityAt DESC` ordering semantics.
- Add a compact recent-session switcher for active specifications to global navigation.
- Show every session associated with a task in that task's details, including multiple sessions and multi-task sessions.
- Provide a create-session flow for a spec and zero/multiple task IDs using enabled local providers.
- Open a session as an addressable full-screen chat with compact context and usable browser back/refresh behavior.
- Render provider-backed message history, incremental deltas, running/loading/failure states, pending permission/question controls, and cancellation when supported.
- Send user messages and interaction responses over HTTP; consume turn progress over SSE.
- Reconnect to a turn without cancelling it and redisplay any unresolved interaction.
- Keep the UI provider-neutral and capability-aware.

## Constraints

- Follow C5-C13, C17 and D4-D5, D9.
- Optimize layout and touch targets for phone use while retaining desktop usability.
- Do not render the large specification header, workflow cards, or finalization controls above chat.
- Do not add a standalone Sessions module or a routing dependency solely for this feature.
- Completed mock sessions are read-only and need not be reactivated.

## Interfaces and boundaries

Frontend hooks own provider/session/message/turn queries and mutations. Addressable navigation stores only provider-neutral session reference data in the URL. Server API owns validation, adapter calls, access policy, and streaming. Task/spec context uses existing slug routes only to resolve the underlying `specId`.

## Area-specific acceptance criteria

1. A session can be opened directly from spec overview, task detail, and global switcher.
2. Refresh/back preserves or restores the selected conversation rather than returning silently to an unrelated view.
3. Permission Allow/Deny and `AskUserQuestion` controls are keyboard- and touch-operable and disappear only after resolution.
4. A dropped/reopened SSE connection shows current output and the same pending interaction without starting a duplicate turn.
5. Provider capability absence disables the relevant control with an explanation.
6. Representative phone and desktop layouts keep context compact and the composer usable.

## Dependencies

Depends on provider-neutral API and mock adapter. The same UI becomes the real Claude UI in Part 2.

## Out of scope

- Attachments, uploads, conversation branching, advanced tools, analytics, billing, or multi-agent UI.
- Google login, user management, allowlists, and role UI.

---
id: nevo-spec-dashboard-refinement.area.spec-content-and-task-details
type: area
change: nevo-spec-dashboard-refinement
---

# Area: Specification content and task details

## Responsibility

Expose canonical overview, area documents, and task bodies through the read-only dashboard backend and present them as a coherent reading experience.

## Current state

The dashboard extracts a short plain-text overview summary and task titles. Complete Markdown bodies remain on disk and are not available to the React client.

## Requirements

- Add an on-demand, read-only content endpoint keyed by active/archive source and exact specification slug.
- Return overview, areas, and task Markdown bodies from canonical files with repository-relative source paths and stable display titles.
- Strip YAML front matter from rendered content while retaining the underlying file as the source of truth.
- Sort areas deterministically by filename and tasks by manifest order.
- Reject traversal and unknown source/slug values without exposing absolute paths.
- Render CommonMark and GFM headings, lists, links, tables, task lists, blockquotes, inline code, and fenced code blocks.
- Add selected-specification navigation for Overview, Specification, Areas, and Changes without adding a router dependency.
- Open full task content from existing lane cards in an accessible detail overlay or panel.

## Interfaces and boundaries

The content endpoint returns local documents only. Provider data is fetched separately and lazily when Changes is selected.

## Area-specific acceptance criteria

1. Missing optional overview or area files produce coherent empty states instead of server errors.
2. A task detail view uses the exact task body associated with the manifest task entry.
3. Markdown links use safe browser behavior and code/table content remains horizontally readable on narrow screens.
4. Closing the task detail restores keyboard focus to its triggering card.

## Out of scope

- Editing or saving Markdown.
- A full document search index or generated table of contents.


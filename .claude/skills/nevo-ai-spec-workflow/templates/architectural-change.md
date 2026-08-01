---
id: spec.<change-slug>
type: change
title: <Title>
status: draft
change: <change-slug>
---

# <Title>

Overview document for an Architectural (class A) change. A guide, not mandatory
boilerplate — omit any section with nothing to say. Pairs with `change.yaml` (the
manifest) and, when the change has more than one independent concern, `areas/<area>.md`
per `templates/area.md` and `tasks/<n>-<id>.md` per `templates/task.md`.

## Context

Why this change is being considered now.

## Current architecture

Grounded in discovery evidence — current behavior, not aspiration.

## Problem

What the current architecture cannot do, or does poorly.

## Constraints

ADRs, package boundaries, compatibility requirements.

## Affected modules

Packages/projects/docs touched.

## Options and trade-offs

Meaningful architectural approaches considered, with trade-offs. Omit dominated options.

## Owner decisions

Reference `owner-decisions.md` entries.

## Proposed architecture

The approach the owner selected, described precisely enough to decompose into areas and
tasks.

## Compatibility and migration *(omit if not applicable)*

Breaking changes, migration steps, deprecation path.

## Areas *(omit if the change is not split)*

List of `areas/<area>.md` files and their one-line responsibility.

## Change-wide acceptance criteria

Testable statements that apply across all areas/tasks.

## Verification strategy

How the change as a whole will be verified (build, tests, manual checks).

## ADR impact *(omit if none)*

New ADRs to write, or existing ADRs this change would supersede (owner decision).

## Out of scope

What this change explicitly does not do.

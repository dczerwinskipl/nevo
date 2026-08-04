# Maintainer doc template

Copy this file to `docs/development/<slug>.md`, remove this notice, and fill in the
front matter and sections below. This template intentionally has no `---`-delimited
front matter block of its own, so `tools/docs.mjs`'s scanner skips it — do not add one
here.

## Front matter to add at the top of the real doc

```yaml
id: development.<slug>
type: development
title: <Subsystem title>
status: <planned | experimental | current | deprecated>
summary: >
  One or two sentences: which subsystem this document governs and what a maintainer
  comes here to learn.
```

## Sections

### Subsystem responsibility

What this subsystem is responsible for, and what it explicitly is not — concrete enough
to distinguish it from neighboring subsystems.

### Control and data flow

How a request/message/event moves through this subsystem — the real sequence, grounded
in source, not an idealized diagram.

### Stable guarantees

What a caller or extender can rely on today — state each guarantee explicitly rather
than leaving it implied by the flow description above.

### Ordering constraints

Any ordering that is a guaranteed contract versus an artifact of current default
configuration — say which, for each constraint; do not present an accidental ordering as
a guarantee.

### Transaction ownership

Who commits, when, and what participates in the same transaction — if genuinely
unresolved, state that explicitly rather than inventing an answer the code doesn't
support.

### Failure and partial-failure semantics

What happens when part of an operation succeeds and part fails — cite real
source/test behavior where determinable, otherwise state it as an open question.

### Intended extension points

The contracts a third party is meant to implement to extend this subsystem, and how an
implementation is discovered/registered.

### Forbidden or unsafe extension approaches

Concrete approaches that look plausible but are unsafe or unsupported — name the
specific type/method involved, not a generic warning.

### Required tests

Which tests must pass, or be added, when changing this subsystem — point at the actual
test project/file, not a general "add tests" instruction.

### Known unresolved decisions

Questions this document deliberately leaves open, with enough context that a future
maintainer knows why — "not yet decided" is a valid, honest entry here.

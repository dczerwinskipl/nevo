---
id: guides.troubleshooting
type: guide
title: Troubleshooting
status: current
summary: >
  Common failure patterns when working with NEvo, generalized beyond any single
  example app, cross-linking the relevant known-issues entries.
---

# Troubleshooting

## Goal

Recognize common NEvo failure patterns and know where to look, without having to
rediscover each one from source.

## Prerequisites

None — this is a reference for diagnosing problems in a service you've already built
following the other usage guides.

## Steps

This guide is organized by symptom, not as a sequential walkthrough.

### A request always fails with a generic error, even with a seemingly-valid token

Check the data-scope match your validator requires, not just whether the user has the
named permission — per [Authorization](authorization.md), access is granted based on
your validator's `Validate(dataScope, message)` logic, not on `PermissionName` matching
alone. A user with the right permission *name* but the wrong data scope (e.g. wrong
tenant/company ID) still fails validation. See `docs/project/known-issues.md` §
"Authorization surfaces a generic HTTP 500, not 403" — the generic status code doesn't
tell you which of several possible causes triggered it.

### An operation reports success but nothing was actually persisted

If you're using `NEvo.Ddd.EventSourcing` without registering your own `IEventStore`,
this is expected: the default is a non-functional stub. See
`docs/project/known-issues.md` § "The default event store is a non-functional stub".

More generally: a `Right`/success result confirms your handler's own logic ran, not
that every downstream persistence call actually wrote data — check the specific
persistence mechanism (event store, outbox, orchestration-state repository) for its
own known gaps in `docs/project/known-issues.md` before assuming success means
persisted.

### Cross-service dispatch doesn't seem to reach the other service

Verify you're checking the **receiving** service's side effects, not the caller's — see
[Cross-service messaging](cross-service-messaging.md) § Verification. A successful
dispatch from the caller's perspective (a `Right` result) only confirms the HTTP call
succeeded, not that the receiving handler's own logic completed as expected.

### An OAuth/token grant type you expect to work returns "unsupported grant type"

Confirm your identity provider actually implements the grant type you're requesting —
declaring a grant type as "allowed" in server configuration (e.g. OpenIddict's
`AllowClientCredentialsFlow()`) does not guarantee every endpoint handler actually
checks for and handles it. See `docs/usage/example-app-walkthrough.md` § "Scenario 1"
for a concrete instance of this gap.

### Orchestration state doesn't survive a restart, or `CompleteAsync` throws

No `IOrchestratorStateRepository` implementation exists anywhere in this repository
today — see `docs/project/known-issues.md` § "No orchestration-state persistence
implementation exists". This is not a configuration mistake; it requires writing your
own implementation.

## Constraints and failure modes

This guide covers patterns confirmed across the framework's current known gaps — it is
not exhaustive. For a defect not listed here, check
`docs/project/known-issues.md` directly, and the specific package's own doc's
"Limitations" section.

## Verification

Not applicable — this is a reference guide, not a walkthrough with its own outcome.

## Next steps

`docs/project/known-issues.md` — the full list of confirmed defects and gaps this
guide draws from.

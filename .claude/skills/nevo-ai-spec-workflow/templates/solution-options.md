# Solution options template

A guide, not mandatory boilerplate — omit fields that don't materially affect the
decision for this change. Used when a change touches an owner-approval gate; see
`references/solution-option-analysis.md` for when this applies.

## Context

One paragraph: what triggered option analysis (which owner-approval gate is touched),
and the acceptance criteria the options must satisfy.

## Options

For each option (minimum two, meaningfully different — see
`docs/ai/specification-workflow.md` § Solution option analysis for the default framing
and when to deviate from it):

```markdown
### Option <n>: <name>

- **Proposed because:** <why this trade-off is worth considering>
- **What changes / what stays the same**
- **Complexity:** <XS|S|M|L|XL|XXL>
- **Trade-offs considered** *(only the dimensions that matter for this decision)*:
  implementation cost · maintenance cost · coupling/cohesion · reversibility ·
  public-API risk · test/regression scope · performance · pattern consistency ·
  migration cost
- **Coupling/boundary check result** *(omit if not applicable — see
  `docs/ai/specification-workflow.md` § Coupling and package-boundary checks)*
- **Unlocks:** <what this makes easier or possible later>
- **Forecloses:** <what this makes harder or impossible later>
- **Good fit when / bad fit when**
```

## Acceptance criteria coverage

Table: option × criterion → Full / Partial / No / Unknown.

## Recommendation

Recommended option, decision basis (acceptance criteria → owner priorities → known
constraints → cost, in that order), and an explicit one-line rejection reason for each
non-recommended option.

## Confirmation

The exact prompt presented to the owner and, once available, their answer — record it
here so `/nevo-ai:spec-review` doesn't have to reconstruct it from conversation history.

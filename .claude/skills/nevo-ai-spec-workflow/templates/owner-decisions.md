# Owner decisions template

A compact, append-only decision record. One entry per material decision — do not create
an entry for minor local choices (see `references/decision-policy.md`).

```markdown
## D<n>: <short title>

- **Question:** <the question as posed to the owner>
- **Options considered:** <option A> | <option B> | ...
- **Decision:** <what the owner chose>
- **Rationale:** <owner's reasoning, if given — omit if not provided>
- **Consequences:** <what this implies for the spec/tasks>
- **Date:** <YYYY-MM-DD>
- **Affected artifacts:** <files/tasks this decision constrains>
```

Do not turn every implementation detail into a `D<n>` entry — only decisions that fall
under the owner-approval gates in `AGENTS.md`, or that a future reader would otherwise
have to re-derive from conversation history.

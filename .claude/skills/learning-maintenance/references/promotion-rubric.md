# Learning Promotion Rubric

Use this rubric while promoting learnings from `documentation/learnings/*.md`.

## Promote

- Repeated reviewer feedback that appears across multiple tickets or rounds.
- Stable workflow expectations (for example preflight order, verification sequencing, triage rules).
- Durable language/style conventions that reduce recurring review churn.
- Documentation path corrections that prevent future broken references.

## Do Not Promote

- One-off ticket specifics (temporary branch state, single-PR implementation detail).
- Environmental noise (flaky external services, transient CI incidents without durable mitigation).
- Personal preference phrasing without repeat evidence.

## Target Mapping

- Update canonical domain skills first for domain guidance:
  - `component-standards`
  - `database-operations`
  - `github-integration-rules`
  - `markdown-security`
- Update other `.claude/skills/**/SKILL.md` files for procedural workflow guidance.
- Update `.claude/rules/*.md` for normative coding and review constraints.
- Update `AGENTS.md` / `CLAUDE.md` when the rule affects all agent runs.
- Update `README.md` files only when operators/contributors need discoverable, high-level guidance.

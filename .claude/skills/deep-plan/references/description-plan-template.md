# Linear Ticket Description Plan Template

This template is optimized for Linear ticket descriptions. It provides comprehensive implementation planning without multi-agent execution concerns (no Task Graph, Execution Order, or Shared Zone Coordination — those belong in `PLAN.md` files used by `execute-plan`).

If a section does not apply, write `N/A` instead of deleting it. Missing sections look like forgetfulness, not intent.

---

## Summary

[One paragraph stating the user-visible outcome, not the implementation task.]

## Context and Goal

[Why this work exists, what triggered it, and what success looks like from the product perspective.]

### Links

- Spec:
- Designs:
- Related tickets:
- API docs:
- Other references:

## Scope and Non-Goals

**In scope:**

- [What this ticket will do]

**Out of scope:**

- [What this ticket will not do] — [why or where it is tracked]

## Constraints and Assumptions

[Anything the implementation must respect. Call out assumptions explicitly.]

- [Backwards compatibility requirements]
- [Performance budgets or latency constraints]
- [Security constraints and data handling rules]
- [Feature flag expectations]
- [Browser support, accessibility requirements]
- [Known system behaviors that must remain unchanged]

## Requirements

### Functional Requirements

- **FR-1**: [Requirement stated with "the system shall" language]
- **FR-2**: [Requirement]

### Non-Functional Requirements

**Performance:**

- [Latency, throughput, or resource constraints]

**Security:**

- [Authentication, authorization, data protection]

**Reliability:**

- [Retry behavior, failure handling, data durability]

**Observability:**

- [Logging, metrics, tracing requirements]

**Accessibility** (if UI work):

- [Screen reader, keyboard navigation, WCAG compliance]

## Acceptance Criteria

Scenario-based criteria using Given/When/Then. Each scenario must be independently testable.

- Given [precondition]
  When [action]
  Then [observable result]
  And [additional assertions]

### Edge Cases

- [Error paths]
- [Empty states]
- [Permission failures]
- [Network errors and timeouts]
- [Partial data and nulls]
- [Duplicate submission and idempotency]
- [Concurrency (two tabs, double clicks)]

## Implementation Plan

### File Touch Map

- `path/to/file.ts`
  - [What changes in this file]
  - [Specific functions, components, or modules affected]

### Data and Migrations

- [New tables, columns, or schema changes]
- [Migration strategy and backwards compatibility]
- [Backfill requirements]

### Feature Flags and Rollout

- [Flag name and where it gates behavior]
- [Default state per environment]
- [Rollout sequence]

### Implementation Notes

- [Tricky parts, gotchas, or non-obvious decisions]
- [Existing patterns to follow or utilities to reuse]
- [Performance considerations]

## Key Design Decisions

| Decision | Chosen Approach | Alternatives Considered | Rationale |
|---|---|---|---|
| [Decision area] | [What was chosen] | [What else was considered] | [Why this approach] |

## Test Plan

### Automated Tests

**Unit:**

- [What to test, which file, which scenarios]

**Integration:**

- [What integration paths to test]

**Component/E2E** (if applicable):

- [User journey tests]

### Manual Verification

- [Step-by-step manual verification instructions]
- [Commands to run]

### Verification Commands

```sh
# [Commands that prove the implementation is correct]
```

## Documentation Updates

- `path/to/doc.md`
  - [What content to add or update]

## Observability and Rollback

**Observability:**

- [Logs to add: event name, key fields]
- [Metrics to track: name, labels, expected deltas]
- [Alerts to create or adjust]

**Rollback:**

- [How to revert if something goes wrong]
- [Data rollback requirements]

## Dependencies and Coordination

- [What must land first]
- [What must ship together]
- [Who needs to be notified]
- [Deploy ordering constraints]

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| [Risk description] | Low/Medium/High | [What breaks] | [How to prevent or handle] |

## Open Questions

| Question | Status | Impact |
|---|---|---|
| [Unresolved question] | Open/Resolved | [What is blocked or affected] |

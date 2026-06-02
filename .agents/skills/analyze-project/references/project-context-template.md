# Project Context: Multi-Agent Execution

Use this template to build the stable project-level context every execution plan inherits.

## 1. Agent Roles & Context Loading

Define each role with:

- specialization
- system prompt/persona
- required reading (ordered)
- domain knowledge assumptions (can assume vs must verify)

## 2. File & Path Ownership

Define:

- exclusive zones (single-role ownership)
- shared zones (with coordination rules)
- read-only references

## 3. Interface Contracts

Document cross-agent contracts with:

- name
- location
- owner
- consumers
- definition
- example usage

State freeze rule: contracts in registry are immutable during plan execution.

## 4. Shared Conventions & Constraints

Capture:

- tech stack and versions
- patterns to follow (with concrete example files)
- patterns to avoid
- naming conventions
- error handling strategy
- import conventions

## 5. Agent Decision Boundaries

Define:

- autonomous decisions
- constrained decisions
- escalation triggers

## 6. Handoff Protocol

Provide fixed handoff artifact format and storage path convention.

## 7. Integration & Merge Strategy

Define:

- branch strategy
- merge order
- conflict resolution
- full integration validation commands

## 8. QA Ownership

Assign ownership for:

- unit tests
- integration tests
- contract tests
- end-to-end tests

Define done gate criteria.

## 9. Environment & Tooling

Document:

- available tools and commands
- environment variables and mocking strategy
- database/service access constraints
- context-window loading priorities

## Authoring Rules

- Prefer real repository paths over placeholders.
- Keep coordination rules explicit for shared files.
- Use exact commands supported by the repository.
- Mark assumptions when data is unavailable.
- Keep document stable; update when architecture or norms change.

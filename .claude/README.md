# .claude directory guide

This folder defines how Claude Code is configured for this repo: rules, skills,
and subagents.

## Directory structure

```
.claude/
├── agent-memory/ # Per-subagent persistent memory
├── hooks/        # Hook scripts
├── rules/        # Coding rules and patterns
├── skills/       # Skills (invoked via /<skill>, auto-applied when relevant)
└── settings.json # Claude Code configuration
```

## Concepts

### Rules (`.claude/rules/`)

Coding patterns that agents should follow. Applied based on context.

- 20 rule files covering major domains
- Read automatically when relevant files are touched

### Skills (`.claude/skills/`)

Specialized knowledge bundles applied automatically when tasks match and
invoked explicitly via `/skill-name` for task workflows.

- Each skill has a `SKILL.md` describing when it activates
- Examples: `component-standards`, `database-operations`, `address-pr`, `learning-maintenance`, `lint`
- Store review learnings in `documentation/learnings/`

### Agents (`.claude/agent-memory/`)

Specialized subagents for focused tasks, each with persistent memory.

- Launched via Task tool
- Examples: `svelte-expert`, `database-architect`, `github-integration-expert`

## When to use what

| Need | Use |
| -- | -- |
| Follow coding patterns | Rules (automatic) |
| Domain expertise during implementation | Skills (automatic) |
| Execute a workflow | Skill (`/skill-name`) |
| Delegate specialized work | Agent (Task tool) |

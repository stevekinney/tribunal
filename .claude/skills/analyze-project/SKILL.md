---
name: analyze-project
description: Generate or refresh a multi-agent project context document and execution-plan authoring prompt from repository analysis. Use when bootstrapping multi-agent orchestration, updating architecture/ownership/contracts guidance, or preparing a reusable planning prompt. Support explicit output path (`OUTPUT=<path>` or plain-language path request); otherwise detect a sensible default path from the project structure.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
argument-hint: '[TYPE=project-context|authoring-prompt] [OUTPUT=<path>]'
---

# Multi-Agent Project Context

Create a high-quality multi-agent planning artifact from real repository structure and conventions.

## Inputs

- `TYPE` (optional):
  - `project-context` (default): build/update the project context foundation document.
  - `authoring-prompt`: build/update the execution-plan authoring prompt.
- `OUTPUT` (optional): explicit file path for the generated document.
  - Honor an explicit user path even if it differs from defaults.

## Output Path Resolution

1. Use `OUTPUT` when supplied.
2. Otherwise resolve a default path with:

```bash
bun .claude/skills/analyze-project/scripts/resolve-output-path.ts --kind <project-context|authoring-prompt>
```

3. Create missing parent directories before writing.
4. Overwrite the target file unless the user explicitly asks for append mode.

## Workflow

1. Determine artifact type (`TYPE`) and output path.
2. Load repository context before drafting:
   - `AGENTS.md`
   - `CLAUDE.md`
   - `README.md`
   - `documentation/GETTING_STARTED.md` (if present)
   - `documentation/ARCHITECTURE.md` (if present)
   - `documentation/TESTING.md` (if present)
   - `.claude/agents/*.md`
   - `.claude/rules/*.md`
   - `.claude/skills/**/SKILL.md` (scan names/descriptions; read deeply only when relevant)
3. Map facts into the required template:
   - For `project-context`, follow `references/project-context-template.md`.
   - For `authoring-prompt`, follow `references/authoring-prompt-template.md`.
4. Replace placeholders with concrete repository values.
5. Keep scope realistic:
   - Prefer existing role names from `.claude/agents/`.
   - Use real file paths.
   - Use actual verification commands (Bun scripts in this repository).
6. Write the final document to the resolved path.

## Quality Bar

- Keep instructions executable and specific.
- Keep section structure stable so downstream agents can parse it.
- Avoid vague language when acceptance criteria or risk mitigation are required.
- State assumptions explicitly where repository evidence is missing.
- Do not invent unavailable tools, services, or environments.

## Validation Checklist

Run these checks before finishing:

1. Output file exists and is non-empty.
2. Every path in the document exists now or is clearly marked as proposed new work.
3. For `project-context`: sections 1-9 are present.
4. For `authoring-prompt`: sections A-G plus self-review are present.
5. Commands and package-manager usage align with repository standards (`bun`).

## References

- Project context template: `references/project-context-template.md`
- Authoring prompt template: `references/authoring-prompt-template.md`

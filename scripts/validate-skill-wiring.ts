import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');

const REQUIRED_SKILLS = [
  'address-pr',
  'analyze-project',
  'commit',
  'component-standards',
  'create-pr',
  'database-operations',
  'execute-plan',
  'github-integration-rules',
  'learning-maintenance',
  'lint',
  'markdown-security',
  'sync-branch',
] as const;

const REMOVED_SKILLS = [
  'ci-workflow-safety',
  'database-performance',
  'drizzle-query-patterns',
  'drizzle-schema-patterns',
  'github-api-patterns',
  'linear-integration',
  'neon-constraints',
  'neon-driver-setup',
  'oauth-integration-patterns',
  'platform-context',
  'postgres-features',
  'review-editor-patterns',
  'svelte-attachments',
  'svelte-reactivity',
  'sveltekit-patterns',
  'temporal-deployment',
  'temporal-error-taxonomy',
  'temporal-sdk-patterns',
  'temporal-testing',
  'testing-patterns',
  'plan-ticket',
  'multi-agent-project-context',
  'multi-agent-plan-ticket',
  'sandbox-reliability-initiative',
  'writing-good-tickets',
] as const;

const ACTIVE_FILE_PATTERNS = [
  '.claude/README.md',
  '.claude/agents/*.md',
  '.claude/rules/*.md',
  '.claude/skills/*/SKILL.md',
  'AGENTS.md',
  'README.md',
] as const;

function listFiles(pattern: string): string[] {
  const glob = new Bun.Glob(pattern);
  return Array.from(glob.scanSync({ cwd: repositoryRoot, onlyFiles: true, dot: true })).sort();
}

function read(relativePath: string): string {
  const absolutePath = resolve(repositoryRoot, relativePath);
  return readFileSync(absolutePath, 'utf-8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractAgentSkills(agentMarkdown: string): string[] {
  const frontmatterMatch = agentMarkdown.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch?.[1]) return [];

  const skillsMatch = frontmatterMatch[1].match(
    /\nskills:\n([\s\S]*?)(\n[A-Za-z_][A-Za-z0-9_-]*:|$)/,
  );
  if (!skillsMatch?.[1]) return [];

  const entries = skillsMatch[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);

  return entries;
}

function verifyAgentSkillReferences(errors: string[]): void {
  const agentFiles = listFiles('.claude/agents/*.md');

  for (const agentFile of agentFiles) {
    const content = read(agentFile);
    const skills = extractAgentSkills(content);

    for (const skill of skills) {
      const skillPath = resolve(repositoryRoot, '.claude/skills', skill, 'SKILL.md');
      if (!existsSync(skillPath)) {
        errors.push(`${agentFile}: references missing skill \`${skill}\``);
      }
    }
  }
}

function verifyRequiredSkills(errors: string[]): void {
  for (const skill of REQUIRED_SKILLS) {
    const skillPath = resolve(repositoryRoot, '.claude/skills', skill, 'SKILL.md');
    if (!existsSync(skillPath)) {
      errors.push(`Missing required skill: .claude/skills/${skill}/SKILL.md`);
    }
  }
}

function verifyRemovedSkillsNotReferenced(errors: string[]): void {
  const activeFiles = new Set<string>();
  for (const pattern of ACTIVE_FILE_PATTERNS) {
    for (const file of listFiles(pattern)) {
      activeFiles.add(file);
    }
  }

  for (const file of activeFiles) {
    const content = read(file);

    for (const removedSkill of REMOVED_SKILLS) {
      // Match full skill tokens only, not hyphenated supersets (e.g.,
      // avoid matching "linear-plan" when checking for "plan").
      const pattern = new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(removedSkill)}(?![A-Za-z0-9-])`);
      if (pattern.test(content)) {
        errors.push(`${file}: still references removed skill \`${removedSkill}\``);
      }
    }
  }
}

function verifyRenamedSkill(errors: string[]): void {
  const analyzeProjectPath = resolve(repositoryRoot, '.claude/skills/analyze-project/SKILL.md');
  if (!existsSync(analyzeProjectPath)) {
    errors.push('Missing renamed skill: .claude/skills/analyze-project/SKILL.md');
  }

  const oldPath = resolve(repositoryRoot, '.claude/skills/multi-agent-project-context/SKILL.md');
  if (existsSync(oldPath)) {
    errors.push(
      'Old renamed skill still exists: .claude/skills/multi-agent-project-context/SKILL.md',
    );
  }
}

function main(): void {
  const errors: string[] = [];

  verifyAgentSkillReferences(errors);
  verifyRequiredSkills(errors);
  verifyRemovedSkillsNotReferenced(errors);
  verifyRenamedSkill(errors);

  if (errors.length > 0) {
    console.error('Skill wiring validation failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log('Skill wiring validation passed.');
}

main();

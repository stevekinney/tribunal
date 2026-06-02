import axe, { type RunOptions } from 'axe-core';
import { expect } from 'vitest';

type AxeRuleOverrides = Record<string, { enabled: boolean }>;

interface A11yOptions {
  context?: string | Element | Document;
  exclude?: string[];
  rules?: AxeRuleOverrides;
}

const defaultRules: AxeRuleOverrides = {
  'color-contrast-enhanced': { enabled: false },
  'landmark-one-main': { enabled: false },
  'page-has-heading-one': { enabled: false },
  region: { enabled: false },
  label: { enabled: false },
};

export async function expectNoA11yViolations(options: A11yOptions = {}): Promise<void> {
  const baseContext: string | Element | Document = options.context ?? document;
  const context =
    options.exclude && options.exclude.length > 0
      ? { include: [baseContext], exclude: options.exclude }
      : baseContext;

  const runOptions: RunOptions = {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: {
      ...defaultRules,
      ...options.rules,
    },
  };

  const results = await axe.run(context, runOptions);
  if (results.violations.length > 0) {
    console.log('\nA11y violations:');
    for (const violation of results.violations) {
      console.log(`  [${violation.impact}] ${violation.id}: ${violation.description}`);
      for (const node of violation.nodes) {
        console.log(`    - ${node.html.substring(0, 100)}...`);
      }
    }
  }
  expect(results.violations).toEqual([]);
}

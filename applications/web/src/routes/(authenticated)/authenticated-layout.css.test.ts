import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(resolve(directory, './+layout.svelte'), 'utf-8');

describe('authenticated layout sidebar styles', () => {
  it('sets the desktop width through an app-owned selector at the Sidebar breakpoint', () => {
    expect(layout).toMatch(
      /@media \(min-width: 48rem\)\s*{\s*:global\(\.app-sidebar\)\s*{\s*inline-size: 13\.5rem;/,
    );
    expect(layout).not.toContain('cinder-sidebar--mobile');
  });
});

export const meta = {
  name: 'cinder-migration',
  description:
    'Replace @tribunal/components with @lostgradient/cinder across applications/web, then delete the old package, building to a green check + build.',
  phases: [
    { title: 'Map', detail: 'reconcile each used component against Cinder real API (read-only, parallel)' },
    { title: 'Install', detail: 'add @lostgradient/cinder, relocate tokens + utilities (gated prerequisites)' },
    { title: 'Apply', detail: 'rewrite each consumer file + compose gap wrappers (parallel, one tree)' },
    { title: 'Verify', detail: 'svelte-check + production build; capped repair loop' },
    { title: 'Delete', detail: 'remove @tribunal/components dead last, only after green' },
  ],
};

// ---------------------------------------------------------------------------
// Shared ground truth (discovered during orientation; passed into agent prompts
// so agents do not have to re-derive it). The migration target is
// applications/web ONLY — @tribunal/components has no other consumer.
// ---------------------------------------------------------------------------
const REPO = '/Users/stevekinney/Developer/tribunal';
const WEB = `${REPO}/applications/web`;
const OLD_PKG = `${REPO}/packages/components`;

// Distinct components actually imported by applications/web, with the exact
// props/snippets in use. The mapping phase fans out over THIS list (one agent
// per component) so each is reconciled once and applied consistently.
const COMPONENTS = [
  { name: 'Button', oldImport: '@tribunal/components/button', cinder: './button', kind: 'direct',
    usedProps: 'href, variant (primary|secondary|ghost), size (lg), icon (lucide component), label, onclick, disabled, class; sometimes children text' },
  { name: 'Alert', oldImport: '@tribunal/components/alert', cinder: './alert', kind: 'direct',
    usedProps: 'variant (info|danger), class; children text' },
  { name: 'Card', oldImport: '@tribunal/components/card', cinder: './card', kind: 'direct',
    usedProps: 'flush (boolean), class; children' },
  { name: 'Link', oldImport: '@tribunal/components/link', cinder: './link', kind: 'direct',
    usedProps: 'href, external (boolean); children' },
  { name: 'Badge', oldImport: '@tribunal/components/badge', cinder: './badge', kind: 'direct',
    usedProps: 'size (sm), code (boolean), label, variant (default|success)' },
  { name: 'EmptyState', oldImport: '@tribunal/components/empty-state', cinder: './empty-state', kind: 'direct',
    usedProps: 'icon (lucide component), title, description, action (snippet)' },
  { name: 'Avatar', oldImport: '@tribunal/components/avatar', cinder: './avatar', kind: 'direct',
    usedProps: 'src, alt' },
  { name: 'Navigation+NavigationItem', oldImport: '@tribunal/components/navigation', cinder: './navigation-bar + ./navigation-item OR ./side-navigation*', kind: 'gap-restructure',
    usedProps: 'Navigation uses start/end/drawer SNIPPETS; NavigationItem uses href, layout (vertical), children. Read (authenticated)/+layout.svelte and pick the Cinder primitive whose snippet/slot shape fits.' },
  { name: 'UserMenu', oldImport: '@tribunal/components/user-menu', cinder: 'compose ./dropdown-menu + ./avatar + ./dropdown-item', kind: 'gap-compose',
    usedProps: 'id, user ({ username, avatarUrl }). Compose a local wrapper from Cinder dropdown primitives that renders the avatar trigger + a sign-out item (form POST /logout, as in the old layout drawer).' },
  { name: 'SkipLinks', oldImport: '@tribunal/components/skip-links', cinder: 'local wrapper over ./visually-hidden + ./link', kind: 'gap-wrapper',
    usedProps: 'no props; renders skip-to-#main-content link. a11y-critical — keep target #main-content.' },
  { name: 'Page', oldImport: '@tribunal/components/page', cinder: 'local app wrapper (lib/components/page.svelte)', kind: 'gap-wrapper',
    usedProps: 'title, description, subtitle, icon (lucide), actions (snippet), tabs (Tab[]), breadcrumbs (BreadcrumbItem[] = {label, href?}), children. Does <svelte:head> SEO (title "X | Tribunal", meta description, og:title/description). Compose header from Cinder breadcrumbs + section-heading/typography; keep <svelte:head> in the wrapper. Only title/subtitle/description/breadcrumbs/children/icon/actions are actually used by current routes.' },
];

const UTILITIES = [
  'format-date.ts (formatRelativeDate, formatRelativeTime, formatTimestamp)',
  'format-duration.ts (formatDuration)',
  'stringify.ts (stringify, stringifyOrNull)',
  'truncate.ts (truncate)',
];

const MAPPING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'strategy', 'newImport', 'propDeltas', 'snippetChanges', 'risk', 'notes'],
  properties: {
    name: { type: 'string' },
    strategy: { type: 'string', enum: ['direct-swap', 'restructure', 'compose-wrapper'] },
    newImport: { type: 'string', description: 'exact import statement(s) to use, or local wrapper path' },
    propDeltas: {
      type: 'array',
      description: 'every prop in use, mapped to its Cinder equivalent',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['oldProp', 'cinderProp', 'action'],
        properties: {
          oldProp: { type: 'string' },
          cinderProp: { type: 'string', description: 'Cinder prop name, or "(none)" if absent' },
          action: { type: 'string', enum: ['keep', 'rename', 'drop', 'replace-with-children', 'replace-with-snippet', 'handle-in-wrapper'] },
        },
      },
    },
    snippetChanges: { type: 'string', description: 'how slots/snippets map (e.g. action snippet, start/end/drawer); "none" if N/A' },
    wrapperSource: { type: 'string', description: 'for compose-wrapper: the FULL Svelte source of the local wrapper component, ready to write; else ""' },
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string' },
  },
};

const APPLY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'status', 'summary'],
  properties: {
    file: { type: 'string' },
    status: { type: 'string', enum: ['edited', 'no-change-needed', 'failed'] },
    summary: { type: 'string', description: 'what changed: imports swapped, props renamed, wrapper used' },
  },
};

const GATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['checkPassed', 'buildPassed', 'errorCount', 'errors', 'diagnosis'],
  properties: {
    checkPassed: { type: 'boolean' },
    buildPassed: { type: 'boolean' },
    errorCount: { type: 'number' },
    errors: { type: 'array', items: { type: 'string' }, description: 'distinct error messages with file:line' },
    diagnosis: { type: 'string', description: 'for each error: is it a PORT error (wrong prop/import) or a CONFIG error (Vite/optimizeDeps/SSR resolving Cinder uncompiled svelte export)?' },
  },
};

const REPAIR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['filesTouched', 'fixesApplied', 'remainingConcern'],
  properties: {
    filesTouched: { type: 'array', items: { type: 'string' } },
    fixesApplied: { type: 'string' },
    remainingConcern: { type: 'string', description: 'anything the next round must know; "none" if confident' },
  },
};

// ===========================================================================
// PHASE 1 — MAP (read-only, parallel over distinct components)
// Each agent reads the OLD implementation AND Cinder's real .d.ts/schema/
// examples side by side, then emits a typed spec. No code is written here.
// ===========================================================================
phase('Map');
log(`Mapping ${COMPONENTS.length} distinct components against Cinder's real API (read-only)`);

const mappings = await parallel(
  COMPONENTS.map((c) => () =>
    agent(
      `You are reconciling a single component for a migration from the in-repo \`@tribunal/components\` design system to the published \`@lostgradient/cinder\` (Svelte 5) library, in the repo at ${REPO}.

COMPONENT: ${c.name}
Old import: ${c.oldImport}
Tentative Cinder target: ${c.cinder}
Migration kind: ${c.kind}
Props/snippets actually used by applications/web: ${c.usedProps}

YOUR JOB — produce an exact, buildable mapping spec. Do NOT write any files.

1. Read the OLD implementation: look under ${OLD_PKG}/src/ for this component's folder (e.g. button/, alert/, page/) — read the .svelte and any index.ts to see its real prop names and snippet/slot shape.
2. Read CINDER's real API. Cinder is installed under node_modules once present, but right now inspect the package source already extracted at /tmp/cinder-inspect/package/. For a direct component, read:
   - /tmp/cinder-inspect/package/dist/components/<name>/index.d.ts  (authoritative prop types)
   - /tmp/cinder-inspect/package/src/components/<name>/*.schema.ts  (prop schema)
   - /tmp/cinder-inspect/package/src/components/<name>/*.examples.json  (canonical usage)
   The export subpath is \`@lostgradient/cinder/<name>\` (kebab-case). Confirm the named export (the component class name) from the index.d.ts.
3. Map EVERY used prop to its Cinder equivalent. If a used prop (e.g. \`label\`, \`flush\`, \`code\`, \`size\`, \`variant\`, \`icon\`) does not exist on the Cinder component, decide the action: rename to the real Cinder prop, drop it, replace with children/snippet, or (for wrappers) handle-in-wrapper. NEVER invent a Cinder prop — base every mapping on what you read in the .d.ts/schema.
4. For gap components (UserMenu, SkipLinks, Page, and Navigation if it must be restructured): write the COMPLETE Svelte source of a local wrapper into the \`wrapperSource\` field. The wrapper lives in applications/web (Page → src/lib/components/page.svelte; UserMenu/SkipLinks → src/lib/components/). It must use Svelte 5 runes ($props, $derived, snippets via {#snippet}/{@render}), match the exact props/snippets the routes pass (see the usedProps above), import the right Cinder primitives by their real export names, and preserve behavior — for Page that means keeping the <svelte:head> SEO block (title "<title> | Tribunal", meta description, og:title, og:description) and breadcrumbs. Use \`clsx\` (already a dep) if you need class merging; do NOT import any @tribunal/components utility.

Return the structured mapping. Be precise — this spec is applied verbatim to ${COMPONENTS.length > 1 ? 'every file that uses this component' : 'the consumer'}.`,
      { label: `map:${c.name}`, phase: 'Map', schema: MAPPING_SCHEMA, agentType: 'svelte-expert' },
    ),
  ),
);

const validMappings = mappings.filter(Boolean);
log(`Got ${validMappings.length}/${COMPONENTS.length} mappings. High-risk: ${validMappings.filter((m) => m.risk === 'high').map((m) => m.name).join(', ') || 'none'}`);

// Build a compact spec blob the apply agents can each consume.
const mappingBlob = validMappings
  .map(
    (m) =>
      `### ${m.name} [${m.strategy}, risk=${m.risk}]\nImport: ${m.newImport}\nProp deltas: ${m.propDeltas
        .map((p) => `${p.oldProp}→${p.cinderProp} (${p.action})`)
        .join('; ')}\nSnippets: ${m.snippetChanges}\nNotes: ${m.notes}`,
  )
  .join('\n\n');

// Wrapper sources to materialize before apply (gap components).
const wrappers = validMappings.filter((m) => m.strategy === 'compose-wrapper' && m.wrapperSource && m.wrapperSource.trim().length > 0);

// ===========================================================================
// PHASE 2 — INSTALL + RELOCATE (gated prerequisites, sequential — one tree)
// Cinder must be installed BEFORE apply or every import fails check.
// Tokens + utilities + wrappers are relocated BEFORE apply so consumers resolve.
// This is one agent owning the shared-file/sequential work.
// ===========================================================================
phase('Install');
log('Installing Cinder, relocating design tokens + utilities, materializing gap wrappers');

const wrapperManifest = wrappers
  .map((w) => `- ${w.name}: write its wrapper source (provided below) to the path implied by its import "${w.newImport}".\n--- SOURCE for ${w.name} ---\n${w.wrapperSource}\n--- END SOURCE ---`)
  .join('\n\n');

const installResult = await agent(
  `You are doing the gated prerequisite work for migrating applications/web from @tribunal/components to @lostgradient/cinder, in ${REPO}. Package manager is Bun. Do these steps IN ORDER and report exactly what you did. Do NOT yet touch the route consumer files (that is the next phase) and do NOT delete @tribunal/components (that is the last phase).

1. INSTALL CINDER: from ${WEB}, run \`bun add @lostgradient/cinder@^0.1.1\`. Confirm it lands in applications/web/package.json dependencies.

2. RELOCATE DESIGN TOKENS (critical — route <style> blocks depend on Tribunal token names that Cinder does NOT define): copy ${OLD_PKG}/src/styles/tokens.css and ${OLD_PKG}/src/styles/foundation.css into ${WEB}/src/lib/styles/ (create the dir). Then edit ${WEB}/src/routes/layout.css: replace the line \`@import '@tribunal/components/styles';\` with imports of (a) Cinder's base — \`@import '@lostgradient/cinder/styles';\` — followed by (b) the relocated Tribunal tokens + foundation, e.g. \`@import '$lib/styles/tokens.css';\` and \`@import '$lib/styles/foundation.css';\`. The Tribunal tokens MUST come AFTER Cinder's base import so they win the cascade (Cinder uses @layer ordering cinder.tokens→foundation→components→utilities; relocated tokens not in a layer will override layered Cinder tokens, which is what we want to preserve current appearance). If a relative path is needed instead of $lib, use the correct relative path from layout.css. Keep the existing \`@import 'katex/dist/katex.min.css';\` line.

3. RELOCATE UTILITIES (pure functions, no Svelte): copy these files from ${OLD_PKG}/src/utilities/ into ${WEB}/src/lib/utilities/: format-date.ts, format-duration.ts, stringify.ts, truncate.ts (${UTILITIES.join(' / ')}). Then rewrite ${WEB}/src/lib/utilities/index.ts so the four re-export lines that currently point at '@tribunal/components/utilities/*' instead point at the local './format-date', './format-duration', './stringify', './truncate'. Keep the existing './slugify' export. Remove the stale "moved to @tribunal/components" comment.

4. MATERIALIZE GAP WRAPPERS: write each of the following local wrapper components verbatim (they were authored by the mapping phase). Create ${WEB}/src/lib/components/ if needed.
${wrapperManifest || '(no compose-wrapper components were produced — skip)'}

Report each step's outcome and the final list of files created/edited. Verify the bun add succeeded before reporting done.`,
  { label: 'install+relocate', phase: 'Install' },
);
log('Prerequisites done. Applying ports to consumer files.');

// ===========================================================================
// PHASE 3 — APPLY (parallel; each consumer file is distinct → safe in one tree)
// ===========================================================================
phase('Apply');

// The exact consumer files (relative to applications/web/src).
const CONSUMER_FILES = [
  'routes/+page.svelte',
  'routes/+error.svelte',
  'routes/(authenticated)/+error.svelte',
  'routes/(authenticated)/+layout.svelte',
  'routes/(authenticated)/repositories/+page.svelte',
  'routes/(authenticated)/repositories/[repositoryId=int]/pull-requests/+page.svelte',
  'routes/(public)/privacy-policy/+page.svelte',
  'routes/(public)/terms-of-use/+page.svelte',
  'routes/login/+page.svelte',
  'routes/auth/callback/+page.svelte',
];

const applied = await parallel(
  CONSUMER_FILES.map((rel) => () =>
    agent(
      `Migrate ONE SvelteKit route file from @tribunal/components to @lostgradient/cinder.

FILE: ${WEB}/src/${rel}

Apply the mapping spec below EXACTLY. For each @tribunal/components import in this file:
- Replace the import with the Cinder import (or local wrapper import) from the spec.
- Rename/drop/transform props per the prop deltas. Convert slots/snippets per the snippet notes.
- For gap components (Page, UserMenu, SkipLinks), import the local wrapper that was written under applications/web/src/lib/components/ (Page → $lib/components/page.svelte, etc.) — its props match what this file already passes, so usage usually stays the same.
- Do NOT touch this file's own <style> block, its lucide-svelte imports, its $lib/* imports, or any business logic. Only the @tribunal/components imports and the corresponding component usage (prop names / snippet shape) change.
- Preserve exact visual/behavioral intent. If the spec says a prop is dropped, make sure the markup still renders the same content (e.g. a dropped \`label\` prop becomes child text).

After editing, confirm there are zero remaining \`@tribunal/components\` references in this file.

=== MAPPING SPEC ===
${mappingBlob}
=== END SPEC ===`,
      { label: `apply:${rel.split('/').pop()}`, phase: 'Apply', schema: APPLY_SCHEMA },
    ),
  ),
);

const editedCount = applied.filter(Boolean).filter((a) => a.status === 'edited').length;
const failedApply = applied.filter(Boolean).filter((a) => a.status === 'failed');
log(`Applied: ${editedCount} edited, ${failedApply.length} failed. ${failedApply.map((f) => f.file).join(', ')}`);

// ===========================================================================
// PHASE 4 — VERIFY + REPAIR (sequential, capped at 5 per CLAUDE.md)
// Gate = svelte-check 0 errors AND production build exit 0. Distinguish
// PORT errors (fix the port) from CONFIG errors (Vite resolving Cinder's
// uncompiled `svelte` export) — the latter is config, not a port bug.
// ===========================================================================
phase('Verify');

let green = false;
let lastGate = null;
const MAX_REPAIR = 5;

for (let round = 1; round <= MAX_REPAIR; round++) {
  const gate = await agent(
    `Run the green gate for the Cinder migration in ${WEB}. Package manager is Bun.

Run BOTH, capture output:
1. \`cd ${WEB} && bun run check\` (svelte-check) — record error count and the distinct error messages with file:line.
2. \`cd ${WEB} && bun run build\` (production build) — record whether it exits 0. IGNORE the known pre-existing drizzle/redis/pglite externalization warnings ("could not be resolved – treating it as an external dependency", "Circular dependency", "Use of eval") — those are NOT migration errors; the baseline build already emitted them and exited 0. Only NEW errors (especially anything mentioning @lostgradient/cinder, a route file, or a token/prop) count.

For each real error, DIAGNOSE it as either:
- PORT error: wrong/missing Cinder prop, wrong import path, missing wrapper, leftover @tribunal/components reference, unresolved token. These are fixed by editing the port/wrapper.
- CONFIG error: Vite optimizeDeps / SSR failing to resolve or compile Cinder's uncompiled \`svelte\` export condition (Cinder ships raw src via the svelte condition; vite-plugin-svelte must compile it). Symptoms: "failed to resolve", "does not provide an export", errors deep in node_modules/@lostgradient/cinder during optimize/SSR. These are fixed in vite.config / svelte.config (e.g. ssr.noExternal or optimizeDeps), NOT in the ports.

Report the structured gate result.`,
    { label: `verify:round-${round}`, phase: 'Verify', schema: GATE_SCHEMA },
  );
  lastGate = gate;

  if (gate.checkPassed && gate.buildPassed) {
    green = true;
    log(`✅ Green on round ${round}: check + build both pass`);
    break;
  }

  log(`Round ${round}: check=${gate.checkPassed ? 'pass' : 'FAIL'} build=${gate.buildPassed ? 'pass' : 'FAIL'}, ${gate.errorCount} errors. Repairing.`);

  if (round === MAX_REPAIR) break; // do not repair after the last verify

  await agent(
    `Fix the failing Cinder migration in ${WEB}. The green gate (bun run check + bun run build) is still failing. Fix the ROOT CAUSE of each error — do not paper over it, do not special-case files, do not suppress warnings.

GATE RESULT:
errors (${lastGate.errorCount}): ${JSON.stringify(lastGate.errors, null, 1)}
diagnosis: ${lastGate.diagnosis}

Guidance:
- PORT errors → fix the consumer file or the local wrapper: correct the Cinder prop name (check the real .d.ts at /tmp/cinder-inspect/package/dist/components/<name>/index.d.ts or node_modules/@lostgradient/cinder), fix the import subpath, supply a missing prop, or remove a leftover @tribunal/components reference.
- CONFIG errors (Cinder's uncompiled \`svelte\` export not resolving/compiling under Vite/SSR) → fix ${WEB}/vite.config.* or svelte.config.* (commonly add '@lostgradient/cinder' to ssr.noExternal, or adjust optimizeDeps.exclude). Do NOT mangle the ports to dodge a config issue.
- A token resolving to nothing (route looks unstyled) means a Tribunal token name is missing → ensure ${WEB}/src/lib/styles/tokens.css is imported in routes/layout.css AFTER Cinder's base.

Apply the fixes. Report files touched and what you changed.`,
    { label: `repair:round-${round}`, phase: 'Verify', schema: REPAIR_SCHEMA },
  );
}

// ===========================================================================
// PHASE 5 — DELETE (dead last, gated on green)
// ===========================================================================
phase('Delete');

if (!green) {
  log(`⛔ NOT green after ${MAX_REPAIR} repair rounds — SKIPPING deletion. Old package left intact for review.`);
  return {
    status: 'incomplete',
    green: false,
    lastGate,
    note: `Migration applied but check/build not green after ${MAX_REPAIR} rounds. @tribunal/components was NOT deleted. Review errors: ${JSON.stringify(lastGate?.errors)}`,
    mappings: validMappings.map((m) => ({ name: m.name, strategy: m.strategy, risk: m.risk })),
  };
}

const deleteResult = await agent(
  `The Cinder migration is green (svelte-check 0 errors + production build exit 0). Now perform the FINAL deletion of @tribunal/components in ${REPO}. Package manager is Bun.

1. Confirm zero references remain: grep -rn "@tribunal/components" applications packages --include="*.ts" --include="*.svelte" --include="*.json" --include="*.css" (exclude node_modules and the packages/components dir itself). If ANY reference remains outside packages/components, STOP and report it instead of deleting — deletion must be safe.
2. Remove the workspace dependency: delete the "@tribunal/components": "workspace:*" line from ${WEB}/package.json dependencies.
3. Delete the package directory: rm -rf ${OLD_PKG}.
4. Reinstall to update the lockfile: from ${REPO}, run \`bun install\`.
5. Re-run the gate ONE more time to confirm deletion didn't break anything: \`cd ${WEB} && bun run check\` and \`cd ${WEB} && bun run build\` — both must still pass (ignore the known pre-existing drizzle/redis/pglite externalization warnings).

Report: whether the grep was clean, what was deleted, and the final check/build status. Do NOT commit.`,
  { label: 'delete-old-package', phase: 'Delete' },
);

return {
  status: 'complete',
  green: true,
  componentsMigrated: validMappings.map((m) => ({ name: m.name, strategy: m.strategy, risk: m.risk })),
  wrappersCreated: wrappers.map((w) => w.name),
  consumerFilesEdited: editedCount,
  installSummary: installResult,
  deleteSummary: deleteResult,
  note: 'Migration complete on branch cinder-migration. @tribunal/components deleted. NOT committed — review the diff.',
};

---
name: markdown-security
description: Canonical markdown security domain pack. Apply secure markdown rendering patterns when modifying src/lib/markdown; prevents XSS through proper sanitization and unified.js phase handling.
allowed-tools:
  - Read
  - Edit
  - Grep
---

# Markdown Security Patterns

## When to use

- Modifying markdown rendering pipeline (`src/lib/markdown/**`)
- Adding URL handling in markdown transforms
- Working with Shiki syntax highlighting
- Implementing Mermaid diagram rendering
- Debugging XSS or sanitization issues

## Do not use

- Consuming markdown (reading/displaying)
- Non-markdown text processing

## Constraints

- Follow `{baseDir}/rules/markdown.md` (security-critical)
- Use `runSync()` for transforms, not just `stringify()`
- Sanitize all URL-containing node types: `link`, `image`, `definition`
- Treat rendered markdown HTML as untrusted when embedding in previews; sandbox iframes or sanitize before injection.
- If a preview renderer fails, **fail closed** (empty/escaped output). Never return unsanitized HTML on error.

## Workflow

1. Ensure the unified pipeline executes transforms via `runSync()`.
2. Sanitize URLs for `link`, `image`, and `definition` nodes.
3. Update Mermaid and cache-key logic when introducing new rendering paths.

## Verification

- `runSync()` is used anywhere sanitizers are registered.
- All URL node types are sanitized (`link`, `image`, `definition`).
- `cd applications/web && vitest run src/lib/editor/security.test.ts src/lib/utilities/safe-url.test.ts` passes when markdown code changes.

## Critical: unified.js execution phases

**Before (sanitization never runs):**
```typescript
// WRONG: stringify() skips transforms
const html = unified().use(rehypeSanitize, schema).stringify(hast);
```

**After (sanitization executes):**
```typescript
// CORRECT: runSync() executes transforms
const sanitizedHast = unified().use(rehypeSanitize, schema).runSync(hast);
const html = unified().use(rehypeStringify).stringify(sanitizedHast);
```

## URL sanitization completeness

Must handle all three node types:

```typescript
import type { Link, Image, Definition } from 'mdast';

visit(root, 'link', (node: Link) => { /* sanitize node.url */ });
visit(root, 'image', (node: Image) => { /* sanitize node.url */ });
visit(root, 'definition', (node: Definition) => { /* sanitize node.url */ });
```

**Why:** Reference-style links `[text][ref]` with `[ref]: javascript:alert(1)` store the URL in a `definition` node, not the `link` node.

## Mermaid security

```typescript
mermaid.initialize({
  securityLevel: 'loose', // Required for text labels
  // Do NOT use DOMPurify - breaks foreignObject elements
});
```

**Why:** Mermaid uses `<foreignObject>` for text labels. DOMPurify strips all content from these elements, rendering diagrams as empty boxes.

## Cache key completeness

Include all dynamic state in cache keys:

```typescript
// BAD: Missing highlighter state
const cacheKey = `${markdown}::${options}`;

// GOOD: Includes highlighter availability
const hasHighlighter = getHighlighterSync() !== null;
const cacheKey = `${markdown}::${options}::hl:${hasHighlighter}`;
```

## Preview sanitizer allowances

- If images are supported, allow `img` tags and `src`/`alt` attributes.
- Permit safe relative and fragment URLs (`/path`, `#section`) alongside absolute URLs.

## See also

- `{baseDir}/rules/markdown.md`
- `{baseDir}/rules/caching.md` (cache key patterns)

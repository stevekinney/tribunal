---
paths:
  - src/lib/document/rendering/**/*
---

# Markdown rendering pipeline

Before editing paths in this rule, load `$markdown-security` and apply its constraints.

## unified.js execution phases

The unified.js pipeline has distinct execution phases. Understanding them prevents security bugs:

- **`runSync()`**: Executes transforms (plugins that modify the AST)
- **`stringify()`**: Only runs the compiler (converts AST to string output)

```typescript
// WRONG: Sanitization never executes - stringify() skips transforms
const html = unified().use(rehypeSanitize, schema).stringify(hast);

// CORRECT: runSync() executes the sanitization transform
const sanitizedHast = unified().use(rehypeSanitize, schema).runSync(hast);
const html = unified().use(rehypeStringify).stringify(sanitizedHast);
```

When `rehype-sanitize` is attached via `.use()` but only `.stringify()` is called, the sanitization transform never runs, leaving XSS vectors in the output.

## mdast node types for URL sanitization

When sanitizing URLs at the mdast level, handle all URL-containing node types:

- **`link`**: Standard markdown links `[text](url)`
- **`image`**: Markdown images `![alt](url)`
- **`definition`**: Reference-style link definitions `[ref]: url`

Reference-style links (`[text][ref]` with `[ref]: javascript:alert(1)`) store the URL in a `definition` node, not the `link` node itself. Forgetting to sanitize definitions leaves this XSS vector open.

```typescript
import type { Link, Image, Definition } from 'mdast';

visit(root, 'link', (node: Link) => {
  /* sanitize node.url */
});
visit(root, 'image', (node: Image) => {
  /* sanitize node.url */
});
visit(root, 'definition', (node: Definition) => {
  /* sanitize node.url */
});
```

## Security flag completeness

The `hadUnsafeContent` flag must reflect ALL sanitization actions. If definition nodes are sanitized but the flag only checks link/image nodes, callers receive incorrect safety information.

## Preview sanitization expectations

- If markdown previews allow images, include `img` in `ALLOWED_TAGS` and `src`/`alt` in `ALLOWED_ATTR` so standard `![alt](url)` syntax survives sanitization.
- Permit safe relative and fragment URLs (`/docs/page`, `#section`) in addition to absolute `http(s)`/`mailto` links.
- Fail closed on rendering or sanitization errors: never return unsanitized HTML as a fallback. Prefer empty string or escaped text when sanitization fails.

## Syntax highlighting with Shiki

### Recursive HTML parsing for nested structures

Shiki v3 wraps each code line in `<span class="line">` containing nested token spans. Simple regex parsers that match `<span.*?>(.*?)</span>` stop at the first closing tag, losing nested structure and causing literal HTML to appear in output.

Use recursive parsing with depth tracking:

```typescript
function parseSpans(html: string): ElementContent[] {
  // Track nesting depth to find matching closing tags
  let depth = 1;
  while (depth > 0) {
    const nextOpen = html.indexOf('<span', searchPos);
    const nextClose = html.indexOf('</span>', searchPos);
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
    } else {
      depth--;
    }
  }
  // Recursively parse inner content
  const innerChildren = parseSpans(innerHtml);
}
```

### Cache keys must include dynamic state

When caching rendering results, include ALL inputs that affect output. The highlighter initialization is asynchronous - requests during the initialization window produce unhighlighted output. If the cache key only includes markdown + options, unhighlighted results get cached and served even after the highlighter becomes ready.

```typescript
// BAD: Missing highlighter state
const cacheKey = `${markdown}::${options}`;

// GOOD: Includes highlighter availability
const hasHighlighter = getHighlighterSync() !== null;
const cacheKey = `${markdown}::${options}::hl:${hasHighlighter}`;
```

### Client-side initialization for SSR-first apps

Server-only initialization (via `hooks.server.ts`) leaves client-side renders without highlighting after SPA navigation. For components that render markdown client-side:

1. Initialize server-side for SSR (first page load)
2. Lazily initialize client-side when the component mounts
3. Trigger re-render when initialization completes

```typescript
let highlighterReady = $state(getHighlighterSync() !== null);

$effect(() => {
  if (browser && !highlighterReady) {
    initializeHighlighter().then(() => {
      highlighterReady = true; // Triggers re-render
    });
  }
});

const result = $derived.by(() => {
  void highlighterReady; // Make it a dependency
  return renderMarkdown(content, options);
});
```

## Mermaid diagram rendering

### Progressive enhancement pattern

Mermaid diagrams render client-side only (SSR outputs code blocks, client hydrates to SVGs). The `MermaidDiagramRenderer` component uses DOM manipulation:

1. Find `<pre>` elements corresponding to mermaid code blocks
2. Create wrapper div with skeleton placeholder
3. Render SVG asynchronously via mermaid library
4. Replace skeleton with rendered SVG or error state
5. Cleanup restores original `<pre>` elements

### Theme reactivity requires `$state`

The `currentTheme` variable must be `$state` (not plain `let`) for theme changes to trigger re-renders. The MutationObserver detects theme changes on `document.documentElement`, and setting the `$state` variable triggers effect cleanup and re-run:

```typescript
let currentTheme = $state<'default' | 'dark' | null>(null);

$effect(() => {
  const effectTheme = currentTheme || detectTheme();
  // ... render with effectTheme

  const observer = new MutationObserver(() => {
    const newTheme = detectTheme();
    if (newTheme !== currentTheme) {
      currentTheme = newTheme; // Triggers effect re-run
    }
  });
  // ...
});
```

### Cache key includes theme

Mermaid SVG cache keys must include theme: `${theme}:${hash(code)}`. Same diagram renders differently per theme.

### Security approach

Use Mermaid's `securityLevel: 'loose'` for diagram rendering. **Do not use DOMPurify** to sanitize Mermaid SVG output.

**Why:** Mermaid uses `<foreignObject>` elements with nested HTML for text labels. DOMPurify (even with custom configs or SVG profile) strips all content from `foreignObject` elements, causing diagrams to render as empty boxes without text.

**What loose mode provides:**
- Removes all `<script>` tags
- Removes `javascript:` URLs
- Removes event handlers (`onclick`, `onload`, etc.)
- Preserves HTML content needed for diagram text labels
- Safe for user-generated diagram code

```typescript
mermaid.initialize({
  securityLevel: 'loose', // Required for text labels
  // No DOMPurify.sanitize() on output
});
```

# Styles and design tokens

Tribunal uses CSS custom properties (design tokens) instead of Tailwind. Tokens
live in `src/lib/styles/tokens.css` and are imported via
`src/lib/styles/index.css`.

## Why no Tailwind?

- Consistent design language across the app
- Smaller bundle size (no utility framework runtime)
- Better theming support via CSS variables
- Scoped component styles instead of ad hoc classes

## Token categories

### Spacing

```css
--space-1: 0.25rem; /* 4px */
--space-2: 0.5rem; /* 8px */
--space-4: 1rem; /* 16px */
/* ... through --space-32 */
```

### Typography

```css
--text-xs, --text-sm, --text-base, --text-lg, --text-xl
--font-sans, --font-mono
--leading-tight, --leading-normal, --leading-relaxed
```

### Colors

```css
--text, --text-muted, --text-subtle
--surface, --surface-raised, --surface-inset
--accent, --accent-hover
--danger, --warning, --success
```

### Shadows & borders

```css
--shadow-sm, --shadow-md, --shadow-lg
--border, --border-muted, --border-strong
--radius-sm, --radius-md, --radius-lg
```

### Additional categories

- Motion: `--duration-fast`, `--duration`, `--ease-standard`
- Z-index scale: `--z-dropdown`, `--z-overlay`, `--z-toast`
- Component tokens: `--control-*` (inputs, selects, textareas)
- Syntax highlighting: `--syntax-*` tokens for code blocks

## Usage

```svelte
<style>
  .card {
    padding: var(--space-4);
    background: var(--surface-raised);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    color: var(--text);
  }
</style>
```

## Theming

Set `data-theme="dark"` or `data-theme="light"` on the root element (or any
subtree) to switch themes. Tokens use `light-dark(...)` with `color-scheme`
to map values.

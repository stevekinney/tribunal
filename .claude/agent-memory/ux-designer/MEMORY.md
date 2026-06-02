# UX Designer Memory

## Common Patterns Observed

### Error State Presentation
- Custom error classes (e.g., `.detail-error`) use `color: var(--text-danger)` token
- Alert component is preferred for errors in most contexts
- Error states should use semantic HTML (paragraph tags with clear error class)

### Design Token Usage
- Text colors: `--text`, `--text-muted`, `--text-subtle`, `--text-disabled`
- Surface colors: `--surface`, `--surface-raised`, `--surface-inset`
- Status colors: `--success`, `--warning`, `--danger`, `--info`
- Border tokens: `--border`, `--border-muted`, `--border-strong`
- Spacing: Use `--space-*` scale (1-32)
- Typography: Use `--text-*` scale (xs, sm, base, lg, etc.)

### Component Patterns
- Loading states typically use `SkeletonText` or `Skeleton` components
- Empty states use `EmptyState` component with icon, title, description
- Status badges use `Badge` with variant matching status type
- Accordion used for collapsible lists with proper ARIA attributes

### Accessibility Checks
- ARIA roles: `role="alert"`, `role="region"`, etc.
- ARIA live regions: `aria-live="polite"` for status updates
- Semantic HTML: proper heading hierarchy, landmark elements
- Keyboard navigation: arrow keys, Home/End for list navigation
- Focus management: proper tabindex, focus-visible styles

## Red Flags to Check
1. Hardcoded colors (e.g., `color: red`) instead of design tokens
2. Missing loading states for async operations
3. Missing error states or generic error messages
4. Missing empty states
5. Poor contrast (especially for disabled/muted text)
6. Missing ARIA attributes for interactive components
7. Non-semantic HTML (divs where buttons/links should be)
8. Missing keyboard navigation support
9. Inconsistent spacing (magic numbers instead of tokens)

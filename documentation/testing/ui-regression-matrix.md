# UI Regression Matrix

This document defines the required permutation matrix for UI testing. Every UI ticket
must verify its changes against these dimensions to prevent state-space coverage gaps.

## Background

A cluster of regression escapes revealed that fixes
validated only the primary happy path but failed in adjacent states. This matrix
ensures systematic coverage of the full state space.

## Required Dimensions

Every UI change must be tested across the following four dimensions at minimum.
The intersection of all dimensions forms the permutation matrix.

### 1. Component State

| State   | Description                                              |
| ------- | -------------------------------------------------------- |
| Empty   | No data loaded, zero items, first-time user experience   |
| Loading | Data is being fetched, skeleton or spinner visible       |
| Active  | Normal usage with representative data                    |
| Error   | Network failure, validation error, or server rejection   |
| Stalled | Operation started but no progress (timeout, hung worker) |

For list-based components, also test:

| Data Density | Description                                   |
| ------------ | --------------------------------------------- |
| Single item  | Exactly one item in the collection            |
| Many items   | Enough items to trigger scroll or pagination  |
| Overflow     | Exceeds container bounds or truncation limits |

### 2. Theme

| Theme | Description                    |
| ----- | ------------------------------ |
| Light | Default light mode             |
| Dark  | Dark mode via OS or app toggle |

All color tokens, surface tokens, and semantic tokens must render correctly in
both themes. Pay special attention to:

- Text contrast against surfaces
- Border visibility
- Icon fill and stroke colors
- Focus ring visibility

### 3. Viewport

| Viewport | Width  | Description               |
| -------- | ------ | ------------------------- |
| Narrow   | 375px  | Mobile / small screen     |
| Wide     | 1280px | Desktop / standard screen |

For responsive layouts, also verify:

- Breakpoint transitions (elements appear/hide correctly)
- Touch target sizes at narrow viewports (minimum 44px)
- Horizontal overflow (no unexpected scrollbars)
- Container query behavior for components that use them

### 4. Data Density

| Density        | Description                                     |
| -------------- | ----------------------------------------------- |
| Minimal        | Shortest possible field values                  |
| Representative | Typical real-world data                         |
| Maximum        | Longest names, largest counts, edge-case values |

## Permutation Template

When writing a UI ticket or story, use this template to enumerate required
permutations. Not every cell needs a dedicated story, but every cell must be
consciously evaluated.

```markdown
### Permutation Coverage

| State   | Light + Narrow | Light + Wide | Dark + Narrow | Dark + Wide |
| ------- | -------------- | ------------ | ------------- | ----------- |
| Empty   | [ ]            | [ ]          | [ ]           | [ ]         |
| Loading | [ ]            | [ ]          | [ ]           | [ ]         |
| Active  | [ ]            | [ ]          | [ ]           | [ ]         |
| Error   | [ ]            | [ ]          | [ ]           | [ ]         |
| Stalled | [ ]            | [ ]          | [ ]           | [ ]         |
```

Mark each cell with:

- `[x]` -- covered by a story or test
- `[~]` -- covered by visual inspection (document when)
- `[-]` -- not applicable (document why)

## Examples from Evidence Cluster

### Repository list (empty, single, many)

The repository list has empty, single-item, and many-item states. Regressions tend
to escape when only the populated, many-item state is tested: empty-state messaging
and single-item spacing are missed.

**Required permutations:** 3 states (empty/single/many) x 2 themes x 2 viewports
= 12 combinations.

### Repository pull request headers

Pull request header components had spacing drift when badge counts changed.
Testing only the "multiple badges" case missed the single-badge and no-badge
states.

**Required permutations:** 3 data densities (none/single/many) x 2 themes x 2
viewports = 12 combinations.

## Applying This Matrix

### For ticket authors

1. Identify which component states apply to the change.
2. Fill in the permutation template in the ticket description.
3. Mark cells that are not applicable with a reason.
4. Explicitly note which permutations are new versus already covered.

### For implementers

1. Create Storybook stories covering at minimum: empty, active, and error states.
2. Use Storybook viewport and theme controls for theme and viewport coverage.
3. Add play-function assertions for interactive states.
4. Document any permutations deferred to follow-up tickets.

### For reviewers

1. Check that the permutation template is present and complete.
2. Verify that stories exist for marked cells.
3. Flag any `[-]` (not applicable) cells that look suspicious.
4. Verify data density coverage for list-based components.

## Related Documents

- `.claude/rules/storybook.md` -- Storybook-specific rules including permutation coverage
- `.claude/rules/testing.md` -- testing environment and pattern rules
- `.claude/rules/component-library.md` -- component API and styling conventions

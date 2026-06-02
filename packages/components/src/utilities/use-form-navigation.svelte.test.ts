/**
 * Tests for useFormNavigation rune.
 *
 * Uses .svelte.test.ts naming to run in browser environment with Playwright.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { cleanup } from 'vitest-browser-svelte';
import { useFormNavigation } from './use-form-navigation.svelte';
import type { UseFormNavigationOptions, FormNavigation } from './use-form-navigation.svelte';

describe('useFormNavigation', () => {
  let container: HTMLDivElement;
  let itemRefs: Map<number, HTMLElement>;
  let orderedIds: number[];

  beforeEach(() => {
    // Create a container with focusable items
    container = document.createElement('div');
    document.body.appendChild(container);
    itemRefs = new Map();
    orderedIds = [];
  });

  afterEach(() => {
    cleanup();
    document.body.removeChild(container);
  });

  function createItem(id: number): HTMLElement {
    const item = document.createElement('div');
    item.setAttribute('data-item-id', String(id));

    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('data-testid', `input-${id}`);
    item.appendChild(input);

    container.appendChild(item);
    itemRefs.set(id, item);
    orderedIds.push(id);

    return item;
  }

  function createNavigation(): FormNavigation {
    return useFormNavigation({
      getItemRefs: () => itemRefs,
      getOrderedIds: () => orderedIds,
      getContainer: () => container,
    });
  }

  describe('module exports', () => {
    it('exports useFormNavigation function', () => {
      expect(typeof useFormNavigation).toBe('function');
    });
  });

  describe('activeIndex', () => {
    it('returns -1 when no item is focused', () => {
      createItem(1);
      createItem(2);
      const navigation = createNavigation();

      expect(navigation.activeIndex).toBe(-1);
    });

    it('returns correct index when item is focused', () => {
      createItem(1);
      const item2 = createItem(2);
      createItem(3);
      const navigation = createNavigation();

      // Focus the input in item 2
      const input = item2.querySelector('input');
      input?.focus();

      expect(navigation.activeIndex).toBe(1);
    });

    it('returns correct index for first item', () => {
      const item1 = createItem(1);
      createItem(2);
      const navigation = createNavigation();

      const input = item1.querySelector('input');
      input?.focus();

      expect(navigation.activeIndex).toBe(0);
    });

    it('returns correct index for last item', () => {
      createItem(1);
      createItem(2);
      const item3 = createItem(3);
      const navigation = createNavigation();

      const input = item3.querySelector('input');
      input?.focus();

      expect(navigation.activeIndex).toBe(2);
    });
  });

  describe('focusByIndex', () => {
    it('focuses the first focusable element in the item', () => {
      createItem(1);
      createItem(2);
      const navigation = createNavigation();

      navigation.focusByIndex(1);

      const input = itemRefs.get(2)?.querySelector('input');
      expect(document.activeElement).toBe(input);
    });

    it('does nothing for invalid index (negative)', () => {
      createItem(1);
      const navigation = createNavigation();

      const originalActive = document.activeElement;
      navigation.focusByIndex(-1);

      expect(document.activeElement).toBe(originalActive);
    });

    it('does nothing for invalid index (too high)', () => {
      createItem(1);
      const navigation = createNavigation();

      const originalActive = document.activeElement;
      navigation.focusByIndex(10);

      expect(document.activeElement).toBe(originalActive);
    });

    it('focuses textarea if present', () => {
      const item = document.createElement('div');
      const textarea = document.createElement('textarea');
      item.appendChild(textarea);
      container.appendChild(item);
      itemRefs.set(1, item);
      orderedIds.push(1);

      const navigation = createNavigation();
      navigation.focusByIndex(0);

      expect(document.activeElement).toBe(textarea);
    });

    it('focuses first focusable element when multiple exist', () => {
      const item = document.createElement('div');
      const textarea = document.createElement('textarea');
      const input = document.createElement('input');
      item.appendChild(textarea);
      item.appendChild(input);
      container.appendChild(item);
      itemRefs.set(1, item);
      orderedIds.push(1);

      const navigation = createNavigation();
      navigation.focusByIndex(0);

      expect(document.activeElement).toBe(textarea);
    });
  });

  describe('focusAdjacent', () => {
    it('focuses next item with positive offset', () => {
      const item1 = createItem(1);
      createItem(2);
      const navigation = createNavigation();

      // Focus first item
      item1.querySelector('input')?.focus();

      navigation.focusAdjacent(1);

      const input2 = itemRefs.get(2)?.querySelector('input');
      expect(document.activeElement).toBe(input2);
    });

    it('focuses previous item with negative offset', () => {
      createItem(1);
      const item2 = createItem(2);
      const navigation = createNavigation();

      // Focus second item
      item2.querySelector('input')?.focus();

      navigation.focusAdjacent(-1);

      const input1 = itemRefs.get(1)?.querySelector('input');
      expect(document.activeElement).toBe(input1);
    });

    it('focuses first item when nothing is focused and offset is positive', () => {
      createItem(1);
      createItem(2);
      const navigation = createNavigation();

      navigation.focusAdjacent(1);

      const input1 = itemRefs.get(1)?.querySelector('input');
      expect(document.activeElement).toBe(input1);
    });

    it('focuses last item when nothing is focused and offset is negative', () => {
      createItem(1);
      createItem(2);
      const navigation = createNavigation();

      navigation.focusAdjacent(-1);

      const input2 = itemRefs.get(2)?.querySelector('input');
      expect(document.activeElement).toBe(input2);
    });

    it('does nothing when at first item and offset is negative', () => {
      const item1 = createItem(1);
      createItem(2);
      const navigation = createNavigation();

      const input1 = item1.querySelector('input');
      input1?.focus();

      navigation.focusAdjacent(-1);

      // Should stay on first item
      expect(document.activeElement).toBe(input1);
    });

    it('does nothing when at last item and offset is positive', () => {
      createItem(1);
      const item2 = createItem(2);
      const navigation = createNavigation();

      const input2 = item2.querySelector('input');
      input2?.focus();

      navigation.focusAdjacent(1);

      // Should stay on last item
      expect(document.activeElement).toBe(input2);
    });

    it('does nothing when list is empty', () => {
      const navigation = createNavigation();
      const originalActive = document.activeElement;

      navigation.focusAdjacent(1);

      expect(document.activeElement).toBe(originalActive);
    });

    it('can skip multiple items with larger offset', () => {
      const item1 = createItem(1);
      createItem(2);
      createItem(3);
      createItem(4);
      const navigation = createNavigation();

      item1.querySelector('input')?.focus();

      navigation.focusAdjacent(2);

      const input3 = itemRefs.get(3)?.querySelector('input');
      expect(document.activeElement).toBe(input3);
    });
  });

  describe('focusFirstMatching', () => {
    it('focuses first item matching predicate', () => {
      createItem(1);
      createItem(2);
      createItem(3);
      const navigation = createNavigation();

      navigation.focusFirstMatching((id) => id === 2);

      const input2 = itemRefs.get(2)?.querySelector('input');
      expect(document.activeElement).toBe(input2);
    });

    it('focuses first matching item when multiple match', () => {
      createItem(1);
      createItem(2);
      createItem(3);
      createItem(4);
      const navigation = createNavigation();

      // Predicate matches even numbers
      navigation.focusFirstMatching((id) => id % 2 === 0);

      const input2 = itemRefs.get(2)?.querySelector('input');
      expect(document.activeElement).toBe(input2);
    });

    it('does nothing when no item matches', () => {
      createItem(1);
      createItem(2);
      const navigation = createNavigation();
      const originalActive = document.activeElement;

      navigation.focusFirstMatching((id) => id === 999);

      expect(document.activeElement).toBe(originalActive);
    });

    it('does nothing when list is empty', () => {
      const navigation = createNavigation();
      const originalActive = document.activeElement;

      navigation.focusFirstMatching(() => true);

      expect(document.activeElement).toBe(originalActive);
    });
  });

  describe('type safety', () => {
    it('accepts valid options', () => {
      const options: UseFormNavigationOptions = {
        getItemRefs: () => new Map(),
        getOrderedIds: () => [],
        getContainer: () => null,
      };

      expect(typeof options.getItemRefs).toBe('function');
      expect(typeof options.getOrderedIds).toBe('function');
      expect(typeof options.getContainer).toBe('function');
    });

    it('FormNavigation has correct shape', () => {
      const navigation: FormNavigation = {
        get activeIndex() {
          return -1;
        },
        focusByIndex: () => {},
        focusAdjacent: () => {},
        focusFirstMatching: () => {},
      };

      expect(typeof navigation.activeIndex).toBe('number');
      expect(typeof navigation.focusByIndex).toBe('function');
      expect(typeof navigation.focusAdjacent).toBe('function');
      expect(typeof navigation.focusFirstMatching).toBe('function');
    });
  });
});

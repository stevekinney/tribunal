/**
 * Form navigation rune for multi-item forms.
 *
 * Provides keyboard-accessible navigation between form items (questions, answers, etc.)
 * using a ref map pattern for tracking focusable elements.
 *
 * @example
 * ```svelte
 * <script>
 *   import { SvelteMap } from 'svelte/reactivity';
 *   import { useFormNavigation } from '../utilities/use-form-navigation.svelte.js';
 *
 *   const itemRefs = new SvelteMap<number, HTMLElement>();
 *   let rootElement = $state<HTMLElement | null>(null);
 *
 *   const navigation = useFormNavigation({
 *     getItemRefs: () => itemRefs,
 *     getOrderedIds: () => items.map(i => i.id),
 *     getContainer: () => rootElement,
 *   });
 *
 *   // Use: navigation.focusByIndex(0), navigation.focusAdjacent(1), navigation.activeIndex
 * </script>
 * ```
 */

export interface UseFormNavigationOptions {
  /** Returns the map of item IDs to their DOM elements */
  getItemRefs: () => Map<number, HTMLElement>;
  /** Returns the ordered list of item IDs (determines navigation order) */
  getOrderedIds: () => number[];
  /** Returns the container element (used for activeElement detection) */
  getContainer: () => HTMLElement | null;
}

export interface FormNavigation {
  /** The index of the currently focused item (-1 if none) */
  readonly activeIndex: number;
  /** Focus the item at the given index */
  focusByIndex(index: number): void;
  /** Focus the item offset positions from the current (positive = forward, negative = backward) */
  focusAdjacent(offset: number): void;
  /** Focus the first item that matches the predicate */
  focusFirstMatching(predicate: (id: number) => boolean): void;
}

/**
 * Create a form navigation controller for multi-item forms.
 */
export function useFormNavigation(options: UseFormNavigationOptions): FormNavigation {
  const { getItemRefs, getOrderedIds, getContainer } = options;

  /**
   * Get the index of the currently focused item.
   * Returns -1 if no item contains the active element.
   */
  function getActiveIndex(): number {
    const container = getContainer();
    const activeElement = container?.ownerDocument?.activeElement;
    if (!activeElement) return -1;

    const orderedIds = getOrderedIds();
    const itemRefs = getItemRefs();

    return orderedIds.findIndex((id) => itemRefs.get(id)?.contains(activeElement));
  }

  /**
   * Focus the first focusable element within the item at the given index.
   */
  function focusByIndex(index: number): void {
    const orderedIds = getOrderedIds();
    const id = orderedIds[index];
    if (id === undefined) return;

    const itemRefs = getItemRefs();
    const node = itemRefs.get(id);
    if (!node) return;

    const focusable = node.querySelector<HTMLElement>(
      'textarea, input, select, button, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }

  /**
   * Focus the item offset positions from the current active item.
   * If no item is focused, starts from first (positive offset) or last (negative offset).
   */
  function focusAdjacent(offset: number): void {
    const orderedIds = getOrderedIds();
    if (orderedIds.length === 0) return;

    const activeIndex = getActiveIndex();
    const nextIndex =
      activeIndex === -1 ? (offset > 0 ? 0 : orderedIds.length - 1) : activeIndex + offset;

    if (nextIndex < 0 || nextIndex >= orderedIds.length) return;

    focusByIndex(nextIndex);
  }

  /**
   * Focus the first item where the predicate returns true.
   */
  function focusFirstMatching(predicate: (id: number) => boolean): void {
    const orderedIds = getOrderedIds();
    const index = orderedIds.findIndex(predicate);
    if (index >= 0) {
      focusByIndex(index);
    }
  }

  return {
    get activeIndex() {
      return getActiveIndex();
    },
    focusByIndex,
    focusAdjacent,
    focusFirstMatching,
  };
}

/**
 * Form keyboard shortcuts rune for multi-item forms.
 *
 * Provides standard keyboard shortcuts:
 * - Cmd/Ctrl+Enter: Submit the form (with validation)
 * - Alt+ArrowUp/Down: Navigate between items
 *
 * @example
 * ```svelte
 * <script>
 *   import { useFormNavigation } from '../utilities/use-form-navigation.svelte.js';
 *   import { useFormKeyboard } from '../utilities/use-form-keyboard.svelte.js';
 *
 *   const navigation = useFormNavigation({ ... });
 *
 *   let showAllErrors = $state(false);
 *
 *   const keyboard = useFormKeyboard({
 *     navigation,
 *     hasErrors: () => Object.keys(inlineErrors).length > 0,
 *     onShowErrors: () => { showAllErrors = true; },
 *     getFormElement: () => rootElement?.querySelector('form'),
 *     isInvalidId: (id) => !!inlineErrors[id] || !!serverErrors[id],
 *   });
 *
 *   // Use: <div onkeydown={keyboard.handleKeydown}>
 * </script>
 * ```
 */

import type { FormNavigation } from './use-form-navigation.svelte';

export interface UseFormKeyboardOptions {
  /** Form navigation controller */
  navigation: FormNavigation;
  /** Returns true if there are inline validation errors */
  hasErrors: () => boolean;
  /** Called when errors should be shown (before focusing first invalid) */
  onShowErrors: () => void;
  /** Returns the form element for submission */
  getFormElement: () => HTMLFormElement | null | undefined;
  /** Returns true if the item with the given ID has an error */
  isInvalidId: (id: number) => boolean;
}

export interface FormKeyboard {
  /** Keydown handler to attach to the form container */
  handleKeydown(event: KeyboardEvent): void;
}

/**
 * Create a form keyboard controller for multi-item forms.
 */
export function useFormKeyboard(options: UseFormKeyboardOptions): FormKeyboard {
  const { navigation, hasErrors, onShowErrors, getFormElement, isInvalidId } = options;

  function handleKeydown(event: KeyboardEvent): void {
    // Cmd/Ctrl+Enter: Submit form (with validation)
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      if (hasErrors()) {
        event.preventDefault();
        onShowErrors();
        navigation.focusFirstMatching(isInvalidId);
        return;
      }

      const formElement = getFormElement();
      formElement?.requestSubmit();
      return;
    }

    // Alt+Arrow: Navigate between items
    // Alt+Arrow doesn't conflict with word navigation (Cmd/Ctrl+Arrow on most platforms)
    if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      navigation.focusAdjacent(event.key === 'ArrowDown' ? 1 : -1);
    }
  }

  return {
    handleKeydown,
  };
}

export interface FormSubmitValidationOptions {
  /** Returns true if there are inline validation errors */
  hasErrors: () => boolean;
  /** Called when errors should be shown */
  onShowErrors: () => void;
  /** Called to focus the first invalid item */
  focusFirstInvalid: () => void;
}

/**
 * Create a submit click handler that validates before submitting.
 * Use this for the submit button's onclick to prevent submission when there are errors.
 */
export function createSubmitClickHandler(options: FormSubmitValidationOptions) {
  const { hasErrors, onShowErrors, focusFirstInvalid } = options;

  return function handleSubmitClick(event: MouseEvent): void {
    if (!hasErrors()) return;

    event.preventDefault();
    onShowErrors();
    focusFirstInvalid();
  };
}

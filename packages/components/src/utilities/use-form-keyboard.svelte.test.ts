/**
 * Tests for useFormKeyboard rune.
 *
 * Uses .svelte.test.ts naming to run in browser environment with Playwright.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { cleanup } from 'vitest-browser-svelte';
import { useFormKeyboard, createSubmitClickHandler } from './use-form-keyboard.svelte';
import type { FormNavigation } from './use-form-navigation.svelte';
import type {
  UseFormKeyboardOptions,
  FormKeyboard,
  FormSubmitValidationOptions,
} from './use-form-keyboard.svelte';

describe('useFormKeyboard', () => {
  let mockNavigation: FormNavigation;
  let formElement: HTMLFormElement;
  let container: HTMLDivElement;
  let hasErrors: boolean;
  let showErrorsCalled: boolean;
  let invalidIds: Set<number>;

  beforeEach(() => {
    container = document.createElement('div');
    formElement = document.createElement('form');
    // Prevent actual form submission
    formElement.addEventListener('submit', (e) => e.preventDefault());
    container.appendChild(formElement);
    document.body.appendChild(container);

    hasErrors = false;
    showErrorsCalled = false;
    invalidIds = new Set();

    mockNavigation = {
      get activeIndex() {
        return 0;
      },
      focusByIndex: vi.fn(),
      focusAdjacent: vi.fn(),
      focusFirstMatching: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  function createKeyboard(): FormKeyboard {
    return useFormKeyboard({
      navigation: mockNavigation,
      hasErrors: () => hasErrors,
      onShowErrors: () => {
        showErrorsCalled = true;
      },
      getFormElement: () => formElement,
      isInvalidId: (id) => invalidIds.has(id),
    });
  }

  function createKeyboardEvent(
    key: string,
    modifiers: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {},
  ): KeyboardEvent {
    return new KeyboardEvent('keydown', {
      key,
      metaKey: modifiers.metaKey ?? false,
      ctrlKey: modifiers.ctrlKey ?? false,
      altKey: modifiers.altKey ?? false,
      bubbles: true,
      cancelable: true,
    });
  }

  describe('module exports', () => {
    it('exports useFormKeyboard function', () => {
      expect(typeof useFormKeyboard).toBe('function');
    });

    it('exports createSubmitClickHandler function', () => {
      expect(typeof createSubmitClickHandler).toBe('function');
    });
  });

  describe('Cmd/Ctrl+Enter submit', () => {
    it('submits form when Cmd+Enter is pressed and no errors', () => {
      const keyboard = createKeyboard();
      const requestSubmitSpy = vi.spyOn(formElement, 'requestSubmit');

      const event = createKeyboardEvent('Enter', { metaKey: true });
      keyboard.handleKeydown(event);

      expect(requestSubmitSpy).toHaveBeenCalled();
      expect(showErrorsCalled).toBe(false);
    });

    it('submits form when Ctrl+Enter is pressed and no errors', () => {
      const keyboard = createKeyboard();
      const requestSubmitSpy = vi.spyOn(formElement, 'requestSubmit');

      const event = createKeyboardEvent('Enter', { ctrlKey: true });
      keyboard.handleKeydown(event);

      expect(requestSubmitSpy).toHaveBeenCalled();
    });

    it('shows errors and focuses first invalid when Cmd+Enter is pressed with errors', () => {
      hasErrors = true;
      invalidIds.add(2);
      const keyboard = createKeyboard();

      const event = createKeyboardEvent('Enter', { metaKey: true });
      keyboard.handleKeydown(event);

      expect(showErrorsCalled).toBe(true);
      expect(mockNavigation.focusFirstMatching).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not submit when errors exist', () => {
      hasErrors = true;
      const keyboard = createKeyboard();
      const requestSubmitSpy = vi.spyOn(formElement, 'requestSubmit');

      const event = createKeyboardEvent('Enter', { metaKey: true });
      keyboard.handleKeydown(event);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
    });

    it('does nothing for plain Enter (no modifier)', () => {
      const keyboard = createKeyboard();
      const requestSubmitSpy = vi.spyOn(formElement, 'requestSubmit');

      const event = createKeyboardEvent('Enter');
      keyboard.handleKeydown(event);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(showErrorsCalled).toBe(false);
    });
  });

  describe('Alt+Arrow navigation', () => {
    it('navigates down on Alt+ArrowDown', () => {
      const keyboard = createKeyboard();

      const event = createKeyboardEvent('ArrowDown', { altKey: true });
      keyboard.handleKeydown(event);

      expect(mockNavigation.focusAdjacent).toHaveBeenCalledWith(1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('navigates up on Alt+ArrowUp', () => {
      const keyboard = createKeyboard();

      const event = createKeyboardEvent('ArrowUp', { altKey: true });
      keyboard.handleKeydown(event);

      expect(mockNavigation.focusAdjacent).toHaveBeenCalledWith(-1);
      expect(event.defaultPrevented).toBe(true);
    });

    it('does nothing for ArrowDown without Alt', () => {
      const keyboard = createKeyboard();

      const event = createKeyboardEvent('ArrowDown');
      keyboard.handleKeydown(event);

      expect(mockNavigation.focusAdjacent).not.toHaveBeenCalled();
    });

    it('does nothing for ArrowUp without Alt', () => {
      const keyboard = createKeyboard();

      const event = createKeyboardEvent('ArrowUp');
      keyboard.handleKeydown(event);

      expect(mockNavigation.focusAdjacent).not.toHaveBeenCalled();
    });

    it('does nothing for Alt+ArrowLeft', () => {
      const keyboard = createKeyboard();

      const event = createKeyboardEvent('ArrowLeft', { altKey: true });
      keyboard.handleKeydown(event);

      expect(mockNavigation.focusAdjacent).not.toHaveBeenCalled();
    });

    it('does nothing for Alt+ArrowRight', () => {
      const keyboard = createKeyboard();

      const event = createKeyboardEvent('ArrowRight', { altKey: true });
      keyboard.handleKeydown(event);

      expect(mockNavigation.focusAdjacent).not.toHaveBeenCalled();
    });
  });

  describe('unhandled keys', () => {
    it('does nothing for regular letter keys', () => {
      const keyboard = createKeyboard();
      const requestSubmitSpy = vi.spyOn(formElement, 'requestSubmit');

      const event = createKeyboardEvent('a');
      keyboard.handleKeydown(event);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(mockNavigation.focusAdjacent).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('does nothing for Escape', () => {
      const keyboard = createKeyboard();

      const event = createKeyboardEvent('Escape');
      keyboard.handleKeydown(event);

      expect(event.defaultPrevented).toBe(false);
    });

    it('does nothing for Tab', () => {
      const keyboard = createKeyboard();

      const event = createKeyboardEvent('Tab');
      keyboard.handleKeydown(event);

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('type safety', () => {
    it('accepts valid options', () => {
      const options: UseFormKeyboardOptions = {
        navigation: mockNavigation,
        hasErrors: () => false,
        onShowErrors: () => {},
        getFormElement: () => null,
        isInvalidId: () => false,
      };

      expect(typeof options.navigation).toBe('object');
      expect(typeof options.hasErrors).toBe('function');
      expect(typeof options.onShowErrors).toBe('function');
      expect(typeof options.getFormElement).toBe('function');
      expect(typeof options.isInvalidId).toBe('function');
    });

    it('FormKeyboard has correct shape', () => {
      const keyboard: FormKeyboard = {
        handleKeydown: () => {},
      };

      expect(typeof keyboard.handleKeydown).toBe('function');
    });
  });
});

describe('createSubmitClickHandler', () => {
  let hasErrors: boolean;
  let showErrorsCalled: boolean;
  let focusFirstInvalidCalled: boolean;

  beforeEach(() => {
    hasErrors = false;
    showErrorsCalled = false;
    focusFirstInvalidCalled = false;
  });

  function createHandler() {
    return createSubmitClickHandler({
      hasErrors: () => hasErrors,
      onShowErrors: () => {
        showErrorsCalled = true;
      },
      focusFirstInvalid: () => {
        focusFirstInvalidCalled = true;
      },
    });
  }

  function createMouseEvent(): MouseEvent {
    return new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
  }

  it('does nothing when there are no errors', () => {
    const handler = createHandler();
    const event = createMouseEvent();

    handler(event);

    expect(showErrorsCalled).toBe(false);
    expect(focusFirstInvalidCalled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('prevents default and shows errors when there are errors', () => {
    hasErrors = true;
    const handler = createHandler();
    const event = createMouseEvent();

    handler(event);

    expect(event.defaultPrevented).toBe(true);
    expect(showErrorsCalled).toBe(true);
    expect(focusFirstInvalidCalled).toBe(true);
  });

  describe('type safety', () => {
    it('accepts valid options', () => {
      const options: FormSubmitValidationOptions = {
        hasErrors: () => false,
        onShowErrors: () => {},
        focusFirstInvalid: () => {},
      };

      expect(typeof options.hasErrors).toBe('function');
      expect(typeof options.onShowErrors).toBe('function');
      expect(typeof options.focusFirstInvalid).toBe('function');
    });
  });
});

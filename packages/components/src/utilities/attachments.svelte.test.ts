/**
 * Tests for Svelte 5 attachment utilities.
 *
 * Uses .svelte.test.ts naming to run in browser environment with Playwright.
 * This is required because the tests manipulate DOM elements and focus state.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  bodyScrollLock,
  createClickOutside,
  createFocusTrap,
  createFocusOnMount,
} from './attachments';

describe('bodyScrollLock', () => {
  let element: HTMLDivElement;
  let originalOverflow: string;

  beforeEach(() => {
    originalOverflow = document.body.style.overflow;
    element = document.createElement('div');
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
    document.body.style.overflow = originalOverflow;
  });

  it('sets body overflow to hidden on mount', () => {
    const cleanup = bodyScrollLock(document.body);
    expect(document.body.style.overflow).toBe('hidden');
    cleanup?.();
  });

  it('restores previous overflow on cleanup', () => {
    document.body.style.overflow = 'auto';
    const cleanup = bodyScrollLock(document.body);
    expect(document.body.style.overflow).toBe('hidden');
    cleanup?.();
    expect(document.body.style.overflow).toBe('auto');
  });

  it('restores empty overflow when none was set', () => {
    document.body.style.overflow = '';
    const cleanup = bodyScrollLock(document.body);
    cleanup?.();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('createClickOutside', () => {
  let container: HTMLDivElement;
  let outsideElement: HTMLDivElement;
  let handlerCallCount: number;

  beforeEach(() => {
    handlerCallCount = 0;
    container = document.createElement('div');
    outsideElement = document.createElement('div');
    document.body.appendChild(container);
    document.body.appendChild(outsideElement);
  });

  afterEach(() => {
    container.remove();
    outsideElement.remove();
  });

  it('calls handler when clicking outside the element', () => {
    const attachment = createClickOutside({ handler: () => handlerCallCount++ });
    const cleanup = attachment(container);

    outsideElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handlerCallCount).toBe(1);

    cleanup?.();
  });

  it('does not call handler when clicking inside the element', () => {
    const child = document.createElement('button');
    container.appendChild(child);

    const attachment = createClickOutside({ handler: () => handlerCallCount++ });
    const cleanup = attachment(container);

    child.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handlerCallCount).toBe(0);

    cleanup?.();
  });

  it('does not attach listener when enabled is false', () => {
    const attachment = createClickOutside({ handler: () => handlerCallCount++, enabled: false });
    const cleanup = attachment(container);

    outsideElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handlerCallCount).toBe(0);

    cleanup?.();
  });

  it('supports a getter function for enabled', () => {
    let enabled = false;
    const attachment = createClickOutside({
      handler: () => handlerCallCount++,
      enabled: () => enabled,
    });
    const cleanup = attachment(container);

    // Initially disabled — click outside should not fire
    outsideElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handlerCallCount).toBe(0);

    // Enable reactively — click outside should now fire
    enabled = true;
    outsideElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handlerCallCount).toBe(1);

    cleanup?.();
  });

  it('removes listener on cleanup', () => {
    const attachment = createClickOutside({ handler: () => handlerCallCount++ });
    const cleanup = attachment(container);
    cleanup?.();

    outsideElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handlerCallCount).toBe(0);
  });
});

describe('createFocusTrap', () => {
  let container: HTMLDivElement;
  let firstButton: HTMLButtonElement;
  let lastButton: HTMLButtonElement;

  beforeEach(() => {
    container = document.createElement('div');
    firstButton = document.createElement('button');
    firstButton.textContent = 'First';
    lastButton = document.createElement('button');
    lastButton.textContent = 'Last';
    container.appendChild(firstButton);
    container.appendChild(lastButton);
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('wraps Tab from last focusable to first', () => {
    const attachment = createFocusTrap();
    const cleanup = attachment(container);

    lastButton.focus();
    expect(document.activeElement).toBe(lastButton);

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    container.dispatchEvent(event);

    expect(document.activeElement).toBe(firstButton);
    expect(event.defaultPrevented).toBe(true);

    cleanup?.();
  });

  it('wraps Shift+Tab from first focusable to last', () => {
    const attachment = createFocusTrap();
    const cleanup = attachment(container);

    firstButton.focus();
    expect(document.activeElement).toBe(firstButton);

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);

    expect(document.activeElement).toBe(lastButton);
    expect(event.defaultPrevented).toBe(true);

    cleanup?.();
  });

  it('does not trap when enabled is false', () => {
    const attachment = createFocusTrap({ enabled: false });
    const cleanup = attachment(container);

    lastButton.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    container.dispatchEvent(event);

    // Should not prevent default since trap is disabled
    expect(event.defaultPrevented).toBe(false);

    cleanup?.();
  });

  it('removes keydown listener on cleanup', () => {
    const attachment = createFocusTrap();
    const cleanup = attachment(container);
    cleanup?.();

    lastButton.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

describe('createFocusOnMount', () => {
  let container: HTMLDivElement;
  let button: HTMLButtonElement;

  beforeEach(() => {
    container = document.createElement('div');
    button = document.createElement('button');
    button.textContent = 'Focus me';
    container.appendChild(button);
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('focuses first focusable element after requestAnimationFrame', async () => {
    const attachment = createFocusOnMount();
    const cleanup = attachment(container);

    // Wait for requestAnimationFrame
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(document.activeElement).toBe(button);

    cleanup?.();
  });

  it('restores focus on cleanup', async () => {
    // Focus something first
    const externalButton = document.createElement('button');
    externalButton.textContent = 'External';
    document.body.appendChild(externalButton);
    externalButton.focus();
    expect(document.activeElement).toBe(externalButton);

    const attachment = createFocusOnMount();
    const cleanup = attachment(container);

    // Wait for focus to move
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(button);

    // Cleanup should restore
    cleanup?.();
    expect(document.activeElement).toBe(externalButton);

    externalButton.remove();
  });

  it('respects restoreTarget option', async () => {
    const restoreButton = document.createElement('button');
    restoreButton.textContent = 'Restore target';
    document.body.appendChild(restoreButton);

    const attachment = createFocusOnMount({ restoreTarget: restoreButton });
    const cleanup = attachment(container);

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    cleanup?.();
    expect(document.activeElement).toBe(restoreButton);

    restoreButton.remove();
  });

  it('does not restore focus when restoreTarget is null', async () => {
    const externalButton = document.createElement('button');
    externalButton.textContent = 'External';
    document.body.appendChild(externalButton);
    externalButton.focus();

    const attachment = createFocusOnMount({ restoreTarget: null });
    const cleanup = attachment(container);

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(document.activeElement).toBe(button);

    cleanup?.();
    // Focus should not be restored to externalButton since restoreTarget is null
    expect(document.activeElement).not.toBe(externalButton);

    externalButton.remove();
  });
});

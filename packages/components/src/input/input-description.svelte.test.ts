import { page } from 'vitest/browser';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, cleanup } from 'vitest-browser-svelte';
import Input from './input.svelte';

/**
 * Injects the component design-system CSS into the document so that
 * computed style assertions (gap, margin-top) reflect real resolved values.
 *
 * Also resets paragraph UA margins so layout measurements are deterministic.
 */
function injectComponentStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --space-2: 0.5rem;
      --field-gap: var(--space-2);
    }
    .form-field {
      display: flex;
      flex-direction: column;
      gap: var(--field-gap);
    }
    .field-description,
    .field-error {
      font-size: 0.8125rem;
      /* Reset UA paragraph margin so getBoundingClientRect measurements
         reflect only the flexbox gap, not browser-default p margins */
      margin: 0;
    }
  `;
  document.head.appendChild(style);
  return style;
}

describe('Input — field-description', () => {
  beforeAll(() => {
    injectComponentStyles();
  });

  afterEach(() => {
    cleanup();
  });

  // -------------------------------------------------------------------------
  // 1. No margin-top class
  // -------------------------------------------------------------------------
  describe('margin-top absence', () => {
    it('field-description element has no inline margin-top style', async () => {
      render(Input, {
        id: 'test-no-margin',
        label: 'Email',
        description: 'We will never share your email.',
      });

      const description = page.getByText('We will never share your email.');
      await expect.element(description).toBeInTheDocument();

      // The description relies on the parent gap — it must not have its own margin-top
      const element = description.element() as HTMLElement;
      expect(element.style.marginTop).toBe('');
    });

    it('field-description class does not include a margin-top property in its class list', async () => {
      render(Input, {
        id: 'test-class-check',
        label: 'Username',
        description: 'Choose a unique username.',
      });

      const description = page.getByText('Choose a unique username.');
      await expect.element(description).toBeInTheDocument();

      // Verify it carries .field-description, not a Tailwind margin-top utility
      const element = description.element() as HTMLElement;
      expect(element.classList.contains('field-description')).toBe(true);

      // None of the classes should be a margin-top utility class
      const marginTopClasses = Array.from(element.classList).filter((cls) => /^mt-/.test(cls));
      expect(marginTopClasses).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. 8px spacing via form-field gap
  // -------------------------------------------------------------------------
  describe('8px gap between input and description', () => {
    it('form-field container has 8px gap (--field-gap = --space-2)', async () => {
      render(Input, {
        id: 'test-gap',
        label: 'Name',
        description: 'Your full name.',
      });

      const description = page.getByText('Your full name.');
      await expect.element(description).toBeInTheDocument();

      const wrapper = (description.element() as HTMLElement).closest('.form-field') as HTMLElement;
      expect(wrapper).not.toBeNull();

      const computedGap = window.getComputedStyle(wrapper).gap;
      // --space-2 = 0.5rem = 8px at default 16px root font size
      expect(computedGap).toBe('8px');
    });

    it('measured pixel distance between input bottom and description top is ~8px', async () => {
      render(Input, {
        id: 'test-gap-layout',
        label: 'City',
        description: 'City of residence.',
      });

      const inputElement = page.getByRole('textbox', { name: 'City' });
      const descriptionElement = page.getByText('City of residence.');

      await expect.element(inputElement).toBeInTheDocument();
      await expect.element(descriptionElement).toBeInTheDocument();

      const inputRect = (inputElement.element() as HTMLElement).getBoundingClientRect();
      const descriptionRect = (descriptionElement.element() as HTMLElement).getBoundingClientRect();

      const gap = descriptionRect.top - inputRect.bottom;
      // Allow a 1px tolerance for subpixel rounding
      expect(gap).toBeGreaterThanOrEqual(7);
      expect(gap).toBeLessThanOrEqual(9);
    });
  });

  // -------------------------------------------------------------------------
  // 3. aria-describedby connection
  // -------------------------------------------------------------------------
  describe('aria-describedby connection', () => {
    it('description element has an id derived from the input id', async () => {
      render(Input, {
        id: 'my-input',
        label: 'Bio',
        description: 'Tell us about yourself.',
      });

      const description = page.getByText('Tell us about yourself.');
      await expect.element(description).toHaveAttribute('id', 'my-input-description');
    });

    it('input has aria-describedby pointing to the description id', async () => {
      render(Input, {
        id: 'my-input',
        label: 'Bio',
        description: 'Tell us about yourself.',
      });

      const input = page.getByRole('textbox', { name: 'Bio' });
      await expect.element(input).toHaveAttribute('aria-describedby', 'my-input-description');
    });

    it('input has no aria-describedby when description is absent', async () => {
      render(Input, {
        id: 'no-desc',
        label: 'Subject',
      });

      const input = page.getByRole('textbox', { name: 'Subject' });
      await expect.element(input).not.toHaveAttribute('aria-describedby');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Spacing in all states
  // -------------------------------------------------------------------------
  describe('spacing consistency across states', () => {
    it('default (idle) state renders description with 8px gap', async () => {
      render(Input, {
        id: 'idle-state',
        label: 'Website',
        description: 'Your personal website URL.',
      });

      const description = page.getByText('Your personal website URL.');
      await expect.element(description).toBeInTheDocument();

      const wrapper = (description.element() as HTMLElement).closest('.form-field') as HTMLElement;
      expect(window.getComputedStyle(wrapper).gap).toBe('8px');
    });

    it('error state renders description and error both with 8px gap from their siblings', async () => {
      render(Input, {
        id: 'error-state',
        label: 'Email',
        description: 'We will never share your email.',
        error: 'Please enter a valid email address.',
      });

      const description = page.getByText('We will never share your email.');
      const errorMessage = page.getByText('Please enter a valid email address.');

      await expect.element(description).toBeInTheDocument();
      await expect.element(errorMessage).toBeInTheDocument();

      const wrapper = (description.element() as HTMLElement).closest('.form-field') as HTMLElement;
      expect(window.getComputedStyle(wrapper).gap).toBe('8px');
    });

    it('disabled state renders description with 8px gap', async () => {
      render(Input, {
        id: 'disabled-state',
        label: 'Readonly field',
        description: 'This field cannot be edited.',
        disabled: true,
      });

      const description = page.getByText('This field cannot be edited.');
      await expect.element(description).toBeInTheDocument();

      const wrapper = (description.element() as HTMLElement).closest('.form-field') as HTMLElement;
      expect(window.getComputedStyle(wrapper).gap).toBe('8px');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Combined aria-describedby (description + error)
  // -------------------------------------------------------------------------
  describe('combined aria-describedby', () => {
    it('aria-describedby lists description id first, then error id', async () => {
      render(Input, {
        id: 'combined',
        label: 'Password',
        description: 'Must be at least 8 characters.',
        error: 'Password is too short.',
      });

      const input = page.getByRole('textbox', { name: 'Password' });
      await expect
        .element(input)
        .toHaveAttribute('aria-describedby', 'combined-description combined-error');
    });

    it('aria-describedby contains only error id when description is absent', async () => {
      render(Input, {
        id: 'error-only',
        label: 'Username',
        error: 'Username already taken.',
      });

      const input = page.getByRole('textbox', { name: 'Username' });
      await expect.element(input).toHaveAttribute('aria-describedby', 'error-only-error');
    });

    it('aria-describedby contains only description id when error is absent', async () => {
      render(Input, {
        id: 'desc-only',
        label: 'Handle',
        description: 'Letters, numbers, and underscores only.',
      });

      const input = page.getByRole('textbox', { name: 'Handle' });
      await expect.element(input).toHaveAttribute('aria-describedby', 'desc-only-description');
    });

    it('both description and error elements are present in the DOM simultaneously', async () => {
      render(Input, {
        id: 'both-present',
        label: 'Code',
        description: 'Enter your 6-digit code.',
        error: 'Code has expired.',
      });

      const description = page.getByText('Enter your 6-digit code.');
      const error = page.getByText('Code has expired.');

      await expect.element(description).toBeInTheDocument();
      await expect.element(error).toBeInTheDocument();
    });

    it('description has class field-description and error has class field-error', async () => {
      render(Input, {
        id: 'class-check',
        label: 'Zip',
        description: 'US postal code.',
        error: 'Invalid zip code.',
      });

      const description = page.getByText('US postal code.');
      const error = page.getByText('Invalid zip code.');

      await expect.element(description).toBeInTheDocument();
      await expect.element(error).toBeInTheDocument();

      const descriptionElement = description.element() as HTMLElement;
      const errorElement = error.element() as HTMLElement;

      expect(descriptionElement.classList.contains('field-description')).toBe(true);
      expect(errorElement.classList.contains('field-error')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Focused state — aria-describedby unchanged when input receives focus
  // -------------------------------------------------------------------------
  describe('focused state', () => {
    it('aria-describedby remains correct after the input receives focus', async () => {
      render(Input, {
        id: 'focused',
        label: 'Search',
        description: 'Search across all repositories.',
      });

      const input = page.getByRole('textbox', { name: 'Search' });
      await input.click();

      await expect.element(input).toHaveAttribute('aria-describedby', 'focused-description');
    });

    it('description remains in the DOM after the input receives focus', async () => {
      render(Input, {
        id: 'focused-desc',
        label: 'Query',
        description: 'Enter your search query.',
      });

      const input = page.getByRole('textbox', { name: 'Query' });
      await input.click();

      const description = page.getByText('Enter your search query.');
      await expect.element(description).toBeInTheDocument();
    });
  });
});

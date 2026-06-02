<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  export const DROPDOWN_CONTEXT = Symbol('dropdown');
  export const DROPDOWN_REGISTER = Symbol('dropdown-register');
  export const DROPDOWN_SET_OPEN = Symbol('dropdown-set-open');

  export type DropdownContext = {
    get menuId(): string;
    get isOpen(): boolean;
    close: () => void;
  };

  export type DropdownProps = HTMLAttributes<HTMLDivElement> & {
    /** Required unique ID for SSR stability and accessibility */
    id: string;
    children?: Snippet;
  };
</script>

<script lang="ts">
  import { setContext } from 'svelte';
  import { cn } from '../utilities/cn.js';

  let { id, class: className, children, ...rest }: DropdownProps = $props();

  let menuRef = $state<HTMLElement | null>(null);
  let isOpen = $state(false);

  function close() {
    menuRef?.hidePopover();
  }

  function setOpen(open: boolean) {
    isOpen = open;
  }

  setContext<DropdownContext>(DROPDOWN_CONTEXT, {
    get menuId() {
      return `${id}-menu`;
    },
    get isOpen() {
      return isOpen;
    },
    close,
  });

  // Register the menu element when it mounts
  function registerMenu(el: HTMLElement | null) {
    menuRef = el;
  }

  // Expose registration function via context
  setContext(DROPDOWN_REGISTER, registerMenu);
  setContext(DROPDOWN_SET_OPEN, setOpen);
</script>

<div class={cn('dropdown', className)} data-dropdown {...rest}>
  {@render children?.()}
</div>

<style>
  .dropdown {
    position: relative;
    display: inline-block;
  }
</style>

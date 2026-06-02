<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  export type DropdownTriggerProps = HTMLButtonAttributes & {
    children?: Snippet;
  };
</script>

<script lang="ts">
  import { hasContext, getContext } from 'svelte';
  import { cn } from '../utilities/cn.js';
  import { DROPDOWN_CONTEXT, type DropdownContext } from './dropdown.svelte';

  if (!hasContext(DROPDOWN_CONTEXT)) {
    throw new Error('DropdownTrigger must be used within a Dropdown');
  }

  let { class: className, children, ...rest }: DropdownTriggerProps = $props();

  const context = getContext<DropdownContext>(DROPDOWN_CONTEXT);
</script>

<button
  type="button"
  class={cn(className)}
  style:anchor-name={`--${context.menuId}`}
  aria-haspopup="menu"
  aria-expanded={context.isOpen}
  popovertarget={context.menuId}
  {...rest}
>
  {@render children?.()}
</button>

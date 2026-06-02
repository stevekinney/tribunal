<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  export type ModalProps = Omit<HTMLAttributes<HTMLDivElement>, 'id'> & {
    /** Required unique ID for accessibility - each modal must have a distinct id */
    id: string;
    open?: boolean;
    /** Modal title - required for accessibility */
    title: string;
    /** Optional description text below the title */
    description?: string;
    /** Show the close button in the top-right corner (default: true) */
    showClose?: boolean;
    onClose?: () => void;
    closeOnOverlayClick?: boolean;
    closeOnEscape?: boolean;
    /** Body content snippet */
    body?: Snippet;
    /** Footer content snippet (typically action buttons) */
    footer?: Snippet;
    /** Main content - use body/footer snippets for standard layout */
    children?: Snippet;
  };
</script>

<script lang="ts">
  import OverlayBase from '../overlay/overlay-base.svelte';

  let {
    id,
    open = $bindable(false),
    title,
    description,
    showClose = true,
    onClose,
    closeOnOverlayClick = true,
    closeOnEscape = true,
    body,
    footer,
    children,
    ...rest
  }: ModalProps = $props();
</script>

<OverlayBase
  {id}
  bind:open
  {title}
  {description}
  {showClose}
  {onClose}
  {closeOnOverlayClick}
  {closeOnEscape}
  variant="modal"
  {body}
  {footer}
  {children}
  {...rest}
/>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Dropdown } from '@lostgradient/cinder/dropdown';
  import { Avatar } from '@lostgradient/cinder/avatar';
  import { LogOut } from 'lucide-svelte';

  type User = {
    username: string;
    avatarUrl: string | null;
  };

  type Props = {
    /** Required unique ID for SSR stability and aria-controls wiring. */
    id: string;
    user: User;
    menuPlacement?: 'default' | 'sidebar-footer';
    class?: string;
    children?: Snippet;
  };

  let { id, user, menuPlacement = 'default', class: className, children }: Props = $props();
</script>

<Dropdown {id} class={className} data-menu-placement={menuPlacement}>
  <Dropdown.Trigger aria-label="User menu" showCaret={false}>
    <Avatar src={user.avatarUrl ?? undefined} alt={user.username} name={user.username} size="sm" />
  </Dropdown.Trigger>
  <Dropdown.Menu>
    <Dropdown.Label>
      <span class="user-menu-username">{user.username}</span>
    </Dropdown.Label>
    <Dropdown.Separator />
    {#if children}
      {@render children()}
      <Dropdown.Separator />
    {/if}
    <form method="POST" action="/logout" class="user-menu-form">
      <Dropdown.Item
        variant="danger"
        onclick={(e) => {
          e.preventDefault();
          const form = e.currentTarget.closest('form');
          form?.requestSubmit();
        }}
      >
        <LogOut class="icon-sm" aria-hidden="true" />
        Sign out
      </Dropdown.Item>
    </form>
  </Dropdown.Menu>
</Dropdown>

<style>
  .user-menu-username {
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .user-menu-form {
    display: contents;
  }

  :global(.cinder-dropdown[data-menu-placement='sidebar-footer'] .cinder-dropdown-menu) {
    inset-block-start: auto;
    inset-block-end: calc(100% + var(--space-1));
    inset-inline-end: 0;
  }
</style>

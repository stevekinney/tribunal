<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type User = {
    username: string;
    avatarUrl: string | null;
  };

  export type UserMenuProps = {
    /** Required unique ID for SSR stability */
    id: string;
    user: User;
    class?: string;
    children?: Snippet;
  };
</script>

<script lang="ts">
  import { LogOut } from 'lucide-svelte';
  import Avatar from '../avatar/avatar.svelte';
  import Dropdown from '../dropdown/dropdown.svelte';
  import DropdownTrigger from '../dropdown/dropdown-trigger.svelte';
  import DropdownMenu from '../dropdown/dropdown-menu.svelte';
  import DropdownItem from '../dropdown/dropdown-item.svelte';
  import DropdownSeparator from '../dropdown/dropdown-separator.svelte';
  import DropdownLabel from '../dropdown/dropdown-label.svelte';

  let { id, user, class: className, children }: UserMenuProps = $props();
</script>

<Dropdown {id} class={className}>
  <DropdownTrigger aria-label="User menu">
    <Avatar src={user.avatarUrl ?? undefined} alt={user.username} />
  </DropdownTrigger>
  <DropdownMenu class="user-menu-dropdown">
    <DropdownLabel>
      <span class="user-menu-username">{user.username}</span>
    </DropdownLabel>
    <DropdownSeparator />
    {#if children}
      {@render children()}
      <DropdownSeparator />
    {/if}
    <form method="GET" action="/logout" class="user-menu-form">
      <DropdownItem
        variant="danger"
        onclick={(e) => {
          e.preventDefault();
          const form = e.currentTarget.closest('form');
          form?.requestSubmit();
        }}
      >
        <LogOut class="icon-sm" aria-hidden="true" />
        Sign out
      </DropdownItem>
    </form>
  </DropdownMenu>
</Dropdown>

<style>
  :global(.user-menu-dropdown) {
    min-width: 200px;
  }

  .user-menu-username {
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .user-menu-form {
    display: contents;
  }
</style>

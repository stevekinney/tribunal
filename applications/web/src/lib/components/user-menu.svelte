<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Dropdown } from '@lostgradient/cinder/dropdown';
  import { Avatar } from '@lostgradient/cinder/avatar';
  import { LogOut } from 'lucide-svelte';

  type User = {
    username: string;
    avatarUrl: string | null;
  };

  interface Props {
    /** Required unique ID for SSR stability and aria-controls wiring. */
    id: string;
    user: User;
    class?: string;
    children?: Snippet;
  }

  let { id, user, class: className, children }: Props = $props();
</script>

<Dropdown {id} class={className}>
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
          const form = (e.currentTarget as HTMLButtonElement).closest('form');
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
</style>

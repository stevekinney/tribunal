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

  const dropdownPlacement = $derived(menuPlacement === 'sidebar-footer' ? 'top-end' : 'bottom-end');
  const logoutFormId = $derived(`${id}-logout-form`);
</script>

<form id={logoutFormId} method="POST" action="/logout"></form>
<Dropdown {id} class={className} placement={dropdownPlacement}>
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
    <Dropdown.Item variant="danger" type="submit" form={logoutFormId}>
      <LogOut class="cinder-icon-sm" aria-hidden="true" />
      Sign out
    </Dropdown.Item>
  </Dropdown.Menu>
</Dropdown>

<style>
  .user-menu-username {
    font-weight: var(--font-medium);
    color: var(--text);
  }
</style>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { enhance } from '$app/forms';
  import { Dropdown } from '@lostgradient/cinder/dropdown';
  import { Avatar } from '@lostgradient/cinder/avatar';
  import { LogOut } from 'lucide-svelte';
  import { broadcastNeonSessionLogout, getNeonAuthClient } from '$lib/auth/neon-client';

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

  /**
   * `use:enhance`'s submit callback is awaited before the form's actual POST
   * to `/logout` (`routes/logout/+server.ts`, which deletes the Tribunal
   * bridge cookie and redirects home) is dispatched. Running the cross-tab
   * broadcast and the Neon Auth sign-out here, before that POST, gives every
   * other tab the best chance to abort its own in-flight session refresh
   * before this request's response deletes the shared cookie.
   *
   * Returning nothing (the default) falls back to `use:enhance`'s own
   * post-submission handling, which follows the server's redirect -- so
   * there's no need to call `goto('/')` ourselves here.
   *
   * Deliberately a plain `<form>`, not a link: if JavaScript never loads,
   * `use:enhance` never attaches and this degrades to a native POST that
   * still deletes the cookie and redirects, unlike a `goto`-only flow that
   * would depend entirely on JS to end the session.
   */
  async function signOutBeforeSubmit(): Promise<void> {
    broadcastNeonSessionLogout();

    try {
      await getNeonAuthClient().signOut();
    } catch (signOutError) {
      // Continue to the native form submission (which still clears
      // Tribunal's own cookie) even if Neon Auth itself is unreachable --
      // but still log it, since this failure mode (the cookie clears, the
      // Neon Auth session itself doesn't) is otherwise silent.
      console.error('Failed to end the Neon Auth session during sign-out', signOutError);
    }
  }
</script>

<form
  id={logoutFormId}
  method="POST"
  action="/logout"
  hidden
  use:enhance={signOutBeforeSubmit}
></form>
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

import { redirect } from '@sveltejs/kit';
import { deleteNeonAuthTokenCookie } from '$lib/server/auth/neon-session';
import type { Actions } from './$types';

// A real form action (not a +server.ts POST handler): user-menu.svelte's
// sign-out form submits here with `use:enhance`, which requires an
// action-result response it can deserialize -- a plain +server.ts endpoint
// returning a raw HTTP redirect doesn't satisfy that contract, and
// use:enhance would surface a deserialization error instead of navigating
// home. This action also works with zero JavaScript: a native, un-enhanced
// `<form method="POST" action="/logout">` submission invokes it exactly the
// same way.
export const actions: Actions = {
  default: async ({ cookies }) => {
    deleteNeonAuthTokenCookie({ cookies });
    redirect(302, '/');
  },
};

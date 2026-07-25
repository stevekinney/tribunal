import {
  getNeonAuthClient,
  type NeonSessionResumeRefreshStatus,
  startNeonSessionRefresh,
} from './neon-client';

export type NeonSessionRefreshState = {
  readonly resumeRefreshStatus: NeonSessionResumeRefreshStatus;
  readonly isResumingSession: boolean;
  readonly hasResumeRefreshFailed: boolean;
};

/**
 * Starts (and tears down on unmount) periodic Neon Auth session refresh for
 * the calling component's lifetime. Call this once, at the top level of any
 * authenticated page or layout's `<script>` block -- every route that
 * requires a signed-in user needs this, not only
 * `(authenticated)/+layout.svelte`. `/onboarding` in particular renders
 * outside that layout (see its own `+page.server.ts`) but is itself
 * authenticated and can run long enough -- installing the GitHub App,
 * picking repositories -- for the bridged session cookie to otherwise expire
 * mid-flow without this.
 *
 * Not fatal if Neon Auth isn't configured -- this is a background
 * durability measure, not a page-load precondition.
 */
export function useNeonSessionRefresh(): NeonSessionRefreshState {
  let resumeRefreshStatus = $state<NeonSessionResumeRefreshStatus>('idle');

  $effect(() => {
    let stopSessionRefresh: (() => void) | undefined;
    try {
      stopSessionRefresh = startNeonSessionRefresh(getNeonAuthClient(), {
        onResumeRefreshStatusChange: (status) => {
          resumeRefreshStatus = status;
        },
      });
    } catch (refreshError) {
      console.error('Failed to start Neon Auth session refresh', refreshError);
      return;
    }

    return () => stopSessionRefresh?.();
  });

  return {
    get resumeRefreshStatus() {
      return resumeRefreshStatus;
    },
    get isResumingSession() {
      return resumeRefreshStatus !== 'idle';
    },
    get hasResumeRefreshFailed() {
      return resumeRefreshStatus === 'failed';
    },
  };
}

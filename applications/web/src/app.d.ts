// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { AuthenticatedApplicationUser, NeonSession } from '$lib/server/auth/neon-session';

declare global {
  namespace App {
    /**
     * Structured error interface for +error.svelte pages.
     * Allows pages to render specific UI based on error type.
     */
    interface Error {
      message: string;
      code?: string;
    }

    interface Locals {
      user: AuthenticatedApplicationUser | null;
      neonSession: NeonSession | null;
      /**
       * Correlation ID for tracing across route, workflow, and sandbox layers.
       * Injected via X-Correlation-Id header or generated if missing.
       */
      correlationId: string;
      /**
       * Unique request ID for this HTTP request.
       * Generated per request for request-level tracing.
       */
      requestId: string;
    }
  }
}

export {};

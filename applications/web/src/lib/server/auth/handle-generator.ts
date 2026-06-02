/**
 * Handle Generation and Validation
 *
 * Handles (usernames) are used for user profile URLs and must be:
 * - 3-39 characters long
 * - Lowercase alphanumeric with hyphens (no leading/trailing hyphens)
 * - Not reserved (admin, api, www, etc.)
 */
import { eq } from 'drizzle-orm';
import { slugify } from '$lib/utilities/slugify';

/**
 * Reserved handles that cannot be used.
 * This is the single source of truth - keep in sync with DB constraint in schema.ts
 */
const RESERVED_HANDLES = new Set([
  // Administrative
  'admin',
  'administrator',
  'root',
  'system',
  'support',
  'help',
  // URL paths & auth
  'api',
  'www',
  'app',
  'auth',
  'oauth',
  'callback',
  'login',
  'logout',
  'signup',
  'signin',
  'register',
  'settings',
  'dashboard',
  'profile',
  'account',
  'user',
  'users',
  // Common services
  'mail',
  'email',
  'billing',
  'payments',
  'docs',
  'blog',
  'status',
  'cdn',
  'static',
  'assets',
  // Branding
  'tribunal',
  'about',
  'team',
  'legal',
  'privacy',
  'terms',
  'contact',
  // Route conflicts (singular and plural)
  'new',
  'create',
  'edit',
  'delete',
  'workspace',
  'workspaces',
  'project',
  'projects',
  'invitation',
  'invitations',
  'connection',
  'connections',
  'connect',
  'member',
  'members',
  'security',
  'onboarding',
  'reauth',
  'link',
  'unlink',
]);

/**
 * Handle format requirements
 */
const HANDLE_MIN_LENGTH = 3;
const HANDLE_MAX_LENGTH = 39;
const HANDLE_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export interface HandleValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate handle format without checking availability.
 */
export function validateHandleFormat(handle: string): HandleValidationResult {
  if (handle.length < HANDLE_MIN_LENGTH) {
    return { valid: false, error: `Handle must be at least ${HANDLE_MIN_LENGTH} characters` };
  }

  if (handle.length > HANDLE_MAX_LENGTH) {
    return { valid: false, error: `Handle must be at most ${HANDLE_MAX_LENGTH} characters` };
  }

  if (!HANDLE_PATTERN.test(handle)) {
    return {
      valid: false,
      error:
        'Handle must be lowercase, start and end with a letter or number, and contain only letters, numbers, and hyphens',
    };
  }

  if (RESERVED_HANDLES.has(handle)) {
    return { valid: false, error: 'This handle is reserved' };
  }

  return { valid: true };
}

/**
 * Suggest a handle from a display name or email.
 * This is not guaranteed to be unique - use isHandleAvailable() to verify.
 */
export function suggestHandle(displayName: string | null, email: string): string {
  // Try display name first
  if (displayName) {
    const suggestion = slugify(displayName);
    if (suggestion.length >= HANDLE_MIN_LENGTH) {
      return suggestion.slice(0, HANDLE_MAX_LENGTH);
    }
  }

  // Fall back to email local part (use || to catch empty strings, not just null/undefined)
  const emailLocal = email.split('@')[0] || 'user';
  const suggestion = slugify(emailLocal);

  if (suggestion.length >= HANDLE_MIN_LENGTH) {
    return suggestion.slice(0, HANDLE_MAX_LENGTH);
  }

  // Last resort: pad with random suffix
  return (suggestion + '-' + randomSuffix()).slice(0, HANDLE_MAX_LENGTH);
}

/**
 * Check if a handle is available (not taken and not reserved).
 */
export async function isHandleAvailable(handle: string): Promise<boolean> {
  // Check format and reserved words
  const formatResult = validateHandleFormat(handle);
  if (!formatResult.valid) {
    return false;
  }

  // Check database
  const [{ db }, table] = await Promise.all([
    import('$lib/server/database'),
    import('@tribunal/database/schema'),
  ]);

  const [existing] = await db
    .select({ id: table.user.id })
    .from(table.user)
    .where(eq(table.user.username, handle))
    .limit(1);

  return !existing;
}

/**
 * Validate and check handle availability.
 * Returns both format validation and availability check.
 */
export async function validateHandle(handle: string): Promise<HandleValidationResult> {
  // Check format first
  const formatResult = validateHandleFormat(handle);
  if (!formatResult.valid) {
    return formatResult;
  }

  // Check availability
  const available = await isHandleAvailable(handle);
  if (!available) {
    return { valid: false, error: 'This handle is already taken' };
  }

  return { valid: true };
}

/**
 * Generate a random suffix for handle uniqueness.
 */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

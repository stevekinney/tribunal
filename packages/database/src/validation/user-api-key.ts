/**
 * Zod schemas for user API key validation.
 * These are input/output validation schemas for the API layer.
 */
import { z } from 'zod';
import { requiredString, idSchema } from './helpers';

/** Maximum number of active API keys per user */
export const MAX_USER_API_KEYS = 10;

/** Prefix regex for validation (strict format: uak_<12hex>) */
export const USER_API_KEY_PREFIX_REGEX = /^uak_[0-9a-f]{12}$/;

// ============================================================================
// INPUT VALIDATION SCHEMAS
// ============================================================================

/**
 * Input validation for key creation.
 * Name is required, description is optional.
 */
export const createUserApiKeySchema = z.object({
  name: requiredString
    .max(255, 'Name must be 255 characters or less')
    .refine((s) => s.trim().length > 0, 'Name cannot be empty'),
  description: z
    .string()
    .trim()
    .max(1000, 'Description must be 1000 characters or less')
    .optional()
    .transform((v) => v || null), // Convert empty string to null
});

export type CreateUserApiKeyInput = z.infer<typeof createUserApiKeySchema>;

/**
 * Input validation for key rotation.
 */
export const rotateUserApiKeySchema = z.object({
  keyId: idSchema,
});

export type RotateUserApiKeyInput = z.infer<typeof rotateUserApiKeySchema>;

/**
 * Input validation for key revocation.
 */
export const revokeUserApiKeySchema = z.object({
  keyId: idSchema,
});

export type RevokeUserApiKeyInput = z.infer<typeof revokeUserApiKeySchema>;

// ============================================================================
// API KEY FORMAT VALIDATION
// ============================================================================

/**
 * Validate user API key prefix format (uak_<12hex>).
 */
export const userApiKeyPrefixSchema = z
  .string()
  .regex(USER_API_KEY_PREFIX_REGEX, 'Invalid key prefix format');

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/**
 * Response shape for created key.
 * Includes rawKey which is shown only once at creation time.
 */
export const userApiKeyCreatedSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  keyPrefix: z.string(),
  rawKey: z.string(), // Full key, shown only at creation
  createdAt: z.date(),
});

export type UserApiKeyCreated = z.infer<typeof userApiKeyCreatedSchema>;

/**
 * Response shape for key listing (no secrets).
 * Used when listing user's API keys.
 */
export const userApiKeyListItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  keyPrefix: z.string(),
  createdAt: z.date(),
  expiresAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
});

export type UserApiKeyListItem = z.infer<typeof userApiKeyListItemSchema>;

/**
 * Response shape for key details.
 * Similar to list item but may include additional fields in the future.
 */
export const userApiKeyDetailSchema = userApiKeyListItemSchema.extend({
  updatedAt: z.date(),
});

export type UserApiKeyDetail = z.infer<typeof userApiKeyDetailSchema>;

/**
 * Response shape for key validity check.
 * Returns only non-sensitive metadata (no hash, no raw key).
 */
export const userApiKeyCheckResponseSchema = z.object({
  ok: z.literal(true),
  key: z.object({
    id: z.number(),
    userId: z.number(),
    prefix: z.string(),
    name: z.string(),
  }),
});

export type UserApiKeyCheckResponse = z.infer<typeof userApiKeyCheckResponseSchema>;

// ============================================================================
// ERROR TYPES
// ============================================================================

/** Error codes for user API key operations */
export const UserApiKeyErrorCode = {
  KEY_LIMIT_REACHED: 'KEY_LIMIT_REACHED',
  INVALID_KEY_FORMAT: 'INVALID_KEY_FORMAT',
  KEY_NOT_FOUND: 'KEY_NOT_FOUND',
  KEY_ALREADY_REVOKED: 'KEY_ALREADY_REVOKED',
  NAME_EMPTY: 'NAME_EMPTY',
} as const;

export type UserApiKeyErrorCode = (typeof UserApiKeyErrorCode)[keyof typeof UserApiKeyErrorCode];

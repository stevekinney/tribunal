/**
 * Common Zod schemas for form validation.
 */
import { z } from 'zod';

/** Non-empty trimmed string */
export const requiredString = z.string().trim().min(1, 'This field is required');

/** Positive integer (for IDs) */
export const idSchema = z.coerce.number().int().positive('Must be a positive integer');

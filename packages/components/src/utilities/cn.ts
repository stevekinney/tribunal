import { type ClassValue } from 'clsx';

/**
 * Utility function to merge class names.
 * Accepts clsx-compatible ClassValue inputs.
 */
export function cn(...inputs: ClassValue[]) {
  return inputs.filter(Boolean).join(' ');
}

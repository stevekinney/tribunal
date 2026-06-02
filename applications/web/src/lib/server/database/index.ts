import { env } from '$env/dynamic/private';
import { createDatabase } from '@tribunal/database';

export { runWithDatabase, createDatabase, type Database } from '@tribunal/database';

export const db = createDatabase(() => {
  const url = env.DATABASE_URL;
  if (!url)
    throw new Error('DATABASE_URL environment variable is required for the web application');
  return url;
});

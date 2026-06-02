import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

// Resolve schema path relative to this config file so drizzle-kit always
// finds it, even if invoked from the repo root via --config.
const configDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(configDir, 'src/schema/index.ts');

// Note: `out` must be a relative path because drizzle-kit prepends './' internally.
// All scripts that use `out` (db:generate, db:migrate, db:check) cd into
// packages/database first, so './drizzle' resolves correctly. db:studio uses
// --config from the repo root but does not read the `out` directory.
export default defineConfig({
  schema: schemaPath,
  out: './drizzle',
  dialect: 'postgresql',
  ...(process.env.DATABASE_URL && {
    dbCredentials: { url: process.env.DATABASE_URL },
  }),
  verbose: true,
  strict: true,
});

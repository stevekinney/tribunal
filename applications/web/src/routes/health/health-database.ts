import { createDatabase, type Database } from '@tribunal/database';
import { sql } from '@tribunal/database/operators';

let cachedHealthDatabase:
  | {
      databaseUrl: string;
      database: Database;
    }
  | undefined;

export async function probeDatabase(databaseUrl: string | undefined): Promise<void> {
  if (!databaseUrl) return;
  await getHealthDatabase(databaseUrl).execute(sql`SELECT 1`);
}

function getHealthDatabase(databaseUrl: string): Database {
  if (cachedHealthDatabase?.databaseUrl !== databaseUrl) {
    cachedHealthDatabase = {
      databaseUrl,
      database: createDatabase(databaseUrl),
    };
  }

  return cachedHealthDatabase.database;
}

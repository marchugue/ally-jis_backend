import { Pool, QueryResultRow } from 'pg';
import { env } from './env';

let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (!env.DATABASE_URL) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const db = getPool();
  if (!db) {
    throw new Error(
      'DATABASE_URL is not set. Add it from Supabase → Project Settings → Database.'
    );
  }

  const result = await db.query<T>(text, params);
  return result.rows;
}

export async function testDatabaseConnection(): Promise<boolean> {
  const db = getPool();
  if (!db) return false;

  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

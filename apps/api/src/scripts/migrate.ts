// Applies db/migrations/*.sql in name order. Migrations are idempotent (IF NOT EXISTS),
// so re-running is safe. Usage (from repo root): npm run db:migrate
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL (see .env.example).');
  process.exit(1);
}

const dir = resolve(import.meta.dirname, '../../../../db/migrations');
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  for (const f of files) {
    await client.query(await readFile(join(dir, f), 'utf8'));
    console.log(`Applied ${f}`);
  }
} finally {
  await client.end();
}

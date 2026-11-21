import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadLiveConfig } from '../live/config.js';
import { createPool, upsertFact } from '../live/fact-store.js';
import { parseFacts } from '../live/ingestion.js';
import { createOpenAIClient, embedMany } from '../live/openai.js';

const BATCH_SIZE = 100;
const file = process.argv[2];

if (!file) {
  console.error('Usage: npm run seed -- <path/to/facts.json>');
  process.exit(1);
}

const facts = parseFacts(JSON.parse(await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8')));
const config = loadLiveConfig();
if (!config) {
  console.error('Set OPENAI_API_KEY and DATABASE_URL (see .env.example).');
  process.exit(1);
}

const openai = createOpenAIClient({ ...config, openaiTimeoutMs: 60_000 });
const pool = createPool(config.databaseUrl);
try {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (let i = 0; i < facts.length; i += BATCH_SIZE) {
      const batch = facts.slice(i, i + BATCH_SIZE);
      const embeddings = await embedMany(openai, config, batch.map(({ statement }) => statement));
      for (const [index, fact] of batch.entries()) {
        await upsertFact(db, fact, embeddings[index]);
      }
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
} finally {
  await pool.end();
}
console.log(`Imported ${facts.length} facts from ${file}`);

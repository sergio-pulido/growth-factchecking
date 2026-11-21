// Seed the fact corpus: reads a JSON file, embeds statements in batches, upserts into Postgres.
// Usage (from repo root): npm run seed -- data/facts.sample.json
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadLiveConfig } from '../live/config.js';
import { createPool, upsertFact } from '../live/fact-store.js';
import type { FactInput } from '../live/fact-store.js';
import { createOpenAIClient, embedMany } from '../live/openai.js';

const BATCH = 100;

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run seed -- <path/to/facts.json>');
  process.exit(1);
}

const config = loadLiveConfig();
if (!config) {
  console.error('Set OPENAI_API_KEY and DATABASE_URL (see .env.example).');
  process.exit(1);
}

const facts = JSON.parse(await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8')) as FactInput[];
for (const f of facts) {
  if (!f.id || !f.statement || !f.sourceUrl) throw new Error(`Invalid fact: ${JSON.stringify(f)}`);
}

const client = createOpenAIClient({ ...config, openaiTimeoutMs: 60_000 });
const pool = createPool(config.databaseUrl);
try {
  for (let i = 0; i < facts.length; i += BATCH) {
    const batch = facts.slice(i, i + BATCH);
    const embeddings = await embedMany(client, config, batch.map((f) => f.statement));
    for (const [j, fact] of batch.entries()) await upsertFact(pool, fact, embeddings[j]!);
    console.log(`Seeded ${Math.min(i + BATCH, facts.length)}/${facts.length}`);
  }
} finally {
  await pool.end();
}

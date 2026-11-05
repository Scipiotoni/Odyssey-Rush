// World persistence: Postgres (when DATABASE_URL is set, e.g. on Render) or a local JSON file.
import fs from 'fs';
import path from 'path';

export async function createStore({ databaseUrl, dataFile }) {
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    // Render internal URLs (no domain) don't use SSL; external ones do.
    const external = /\.(render\.com|supabase\.co|neon\.tech)|sslmode=require/.test(databaseUrl);
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl: external ? { rejectUnauthorized: false } : false, max: 2 });
    await pool.query('CREATE TABLE IF NOT EXISTS world_state (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    return {
      kind: 'postgres',
      async load() {
        const r = await pool.query('SELECT data FROM world_state WHERE id = $1', ['main']);
        return r.rows[0] ? JSON.parse(r.rows[0].data) : null;
      },
      async save(obj) {
        const json = JSON.stringify(obj);
        await pool.query('INSERT INTO world_state (id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', ['main', json]);
        return json.length;
      },
      close: () => pool.end(),
    };
  }
  return {
    kind: 'file',
    async load() {
      if (!fs.existsSync(dataFile)) return null;
      return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    },
    async save(obj) {
      const json = JSON.stringify(obj);
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      const tmp = dataFile + '.tmp';
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, dataFile);
      return json.length;
    },
    close: async () => {},
  };
}

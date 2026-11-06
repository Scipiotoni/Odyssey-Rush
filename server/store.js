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
      async load(id = 'main') {
        const r = await pool.query('SELECT data FROM world_state WHERE id = $1', [id]);
        return r.rows[0] ? JSON.parse(r.rows[0].data) : null;
      },
      async save(obj, id = 'main') {
        const json = JSON.stringify(obj);
        await pool.query('INSERT INTO world_state (id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [id, json]);
        return json.length;
      },
      async remove(id) { await pool.query('DELETE FROM world_state WHERE id = $1', [id]); },
      close: () => pool.end(),
    };
  }
  // the main world keeps its old file; other servers and the registry sit next to it
  const fileFor = (id) => (id === 'main' ? dataFile : dataFile.replace(/\.json$/, '') + '.' + String(id).replace(/[^a-z0-9_-]/gi, '') + '.json');
  return {
    kind: 'file',
    async load(id = 'main') {
      const file = fileFor(id);
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    async save(obj, id = 'main') {
      const json = JSON.stringify(obj), file = fileFor(id);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, file);
      return json.length;
    },
    async remove(id) { try { fs.unlinkSync(fileFor(id)); } catch {} },
    close: async () => {},
  };
}

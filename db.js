// Single-user state store: one row, the whole app state as JSONB.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1|@postgres|@casaudit/.test(process.env.DATABASE_URL || '')
    ? false : { rejectUnauthorized: false },
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      state      jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await pool.query(`INSERT INTO app_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
}

async function isHealthy() {
  try { await pool.query('SELECT 1'); return true; } catch (e) { return false; }
}

module.exports = { pool, migrate, isHealthy };

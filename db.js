// Single-user state store: one row, the whole app state as JSONB.
const { Pool } = require('pg');

// Coolify's internal Postgres speaks no SSL; only an external URL that
// explicitly asks for it (sslmode=require) gets it.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /sslmode=require/i.test(process.env.DATABASE_URL || '')
    ? { rejectUnauthorized: false } : false,
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

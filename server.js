// ══════════════════════════════════════════════════════════════
//  CAS Auditor server - single-user (Simon), one state blob.
//
//  - POST /api/auth/login       email+password (env-seeded) -> JWT
//  - GET  /api/state            (Bearer) the whole app state
//  - PUT  /api/state            (Bearer) replace the whole app state
//  - GET  /api/link/state       (LINK_SERVICE_TOKEN) per-client payload
//                               for the Compass linked-apps pull
//  - GET  /healthz              process + database
//
//  The front end stays dual-mode: signed out (or opened as a file) it
//  runs on localStorage exactly as before; signed in, every save also
//  lands here.
// ══════════════════════════════════════════════════════════════
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { pool, migrate, isHealthy } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || '';

app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

// ── static front end (no-cache on the shell so deploys land at once) ──
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// ── health ──
app.get('/healthz', async (_req, res) => {
  const dbOk = await isHealthy();
  if (!dbOk) return res.status(503).json({ ok: false, db: false });
  res.json({ ok: true, db: true, ts: new Date().toISOString() });
});

// ── auth: the one user comes from ADMIN_EMAIL / ADMIN_PASSWORD ──
function timingEqual(a, b) {
  const A = Buffer.from(String(a), 'utf8');
  const B = Buffer.from(String(b), 'utf8');
  if (A.length !== B.length) { crypto.timingSafeEqual(B, B); return false; }
  return crypto.timingSafeEqual(A, B);
}

app.post('/api/auth/login', (req, res) => {
  if (!SECRET || SECRET.length < 32) return res.status(503).json({ error: 'auth_not_configured' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const wantEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const wantPass = String(process.env.ADMIN_PASSWORD || '');
  if (!wantEmail || !wantPass) return res.status(503).json({ error: 'auth_not_configured' });
  const okEmail = timingEqual(email, wantEmail);
  const okPass = timingEqual(password, wantPass);
  if (!okEmail || !okPass) return res.status(401).json({ error: 'bad_credentials' });
  const token = jwt.sign({ sub: 'admin' }, SECRET, { expiresIn: '30d' });
  res.json({ ok: true, token, name: process.env.ADMIN_NAME || 'Simon Archer' });
});

function requireAuth(req, res, next) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'missing_token' });
  try { jwt.verify(m[1], SECRET); next(); }
  catch (e) { return res.status(401).json({ error: 'bad_token' }); }
}

// ── state ──
app.get('/api/state', requireAuth, async (_req, res) => {
  try {
    const r = await pool.query(`SELECT state, updated_at FROM app_state WHERE id = 1`);
    res.json({ ok: true, state: r.rows[0]?.state || {}, updatedAt: r.rows[0]?.updated_at || null });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

app.put('/api/state', requireAuth, async (req, res) => {
  const state = req.body?.state;
  if (!state || typeof state !== 'object' || !Array.isArray(state.clients)) {
    return res.status(400).json({ error: 'bad_state' });
  }
  try {
    const r = await pool.query(
      `UPDATE app_state SET state = $1, updated_at = now() WHERE id = 1 RETURNING updated_at`,
      [JSON.stringify(state)]);
    res.json({ ok: true, updatedAt: r.rows[0].updated_at });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

// ── linked-apps read: same contract the inspection app serves ──
//    GET /api/link/state?tenantId=<casaudit client id>
//    Auth: Bearer LINK_SERVICE_TOKEN (server-to-server only, >= 32 chars).
app.get('/api/link/state', async (req, res) => {
  const configured = process.env.LINK_SERVICE_TOKEN || '';
  if (configured.length < 32) return res.status(503).json({ error: 'link_not_configured' });
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m || !timingEqual(m[1], configured)) return res.status(401).json({ error: 'bad_token' });

  const clientId = String(req.query?.tenantId || '').trim();
  if (!clientId) return res.status(400).json({ error: 'tenant_required' });
  try {
    const r = await pool.query(`SELECT state, updated_at FROM app_state WHERE id = 1`);
    const clients = (r.rows[0]?.state && Array.isArray(r.rows[0].state.clients)) ? r.rows[0].state.clients : [];
    const client = clients.find(c => c && c.id === clientId);
    if (!client) return res.status(404).json({ error: 'tenant_not_found' });
    res.json({ ok: true, state: client, updatedAt: r.rows[0].updated_at || null });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

migrate()
  .then(() => app.listen(PORT, () => console.log('CAS Auditor listening on ' + PORT)))
  .catch((e) => { console.error('migrate failed:', e); process.exit(1); });

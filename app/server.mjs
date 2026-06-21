// manticthink à la carte — BYOK AI services (MVP control plane)
// Dependency-free Node 22. Storage: node:sqlite. Crypto: AES-256-GCM key vault.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT || 8123);
const HOST = '127.0.0.1';
const ROOT = '/root/alacarte';
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

if (!process.env.MASTER_KEY || !process.env.COOKIE_SECRET) {
  console.error('FATAL: MASTER_KEY and COOKIE_SECRET must be set'); process.exit(1);
}
const MASTER_KEY = Buffer.from(process.env.MASTER_KEY, 'hex'); // 32 bytes
const COOKIE_SECRET = process.env.COOKIE_SECRET;

// ---------- db ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'alacarte.db'));
db.exec(`CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, email TEXT UNIQUE, pass TEXT, created INTEGER)`);
db.exec(`CREATE TABLE IF NOT EXISTS keys(
  user_id TEXT, provider TEXT, iv TEXT, tag TEXT, ct TEXT, base_url TEXT, added INTEGER,
  PRIMARY KEY(user_id, provider))`);

// ---------- crypto ----------
const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + dk.toString('hex');
};
const verifyPassword = (pw, stored) => {
  const [s, h] = stored.split(':');
  const dk = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  const hb = Buffer.from(h, 'hex');
  return dk.length === hb.length && crypto.timingSafeEqual(dk, hb);
};
const encrypt = (plain) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), ct: ct.toString('hex') };
};
const decrypt = ({ iv, tag, ct }) => {
  const d = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(ct, 'hex')), d.final()]).toString('utf8');
};

// ---------- signed cookies (stateless sessions) ----------
const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (val) => val + '.' + crypto.createHmac('sha256', COOKIE_SECRET).update(val).digest('base64url');
const unsign = (signed) => {
  if (!signed) return null;
  const i = signed.lastIndexOf('.'); if (i < 0) return null;
  const val = signed.slice(0, i), mac = signed.slice(i + 1);
  const exp = crypto.createHmac('sha256', COOKIE_SECRET).update(val).digest('base64url');
  if (mac.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(exp))) return null;
  return val;
};
const makeSession = (uid) => sign(b64(JSON.stringify({ u: uid, e: Date.now() + 6048e5 })));
const parseCookies = (h) => Object.fromEntries((h || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(p => p[0]));
const readSession = (req) => {
  const raw = unsign(parseCookies(req.headers.cookie).sid);
  if (!raw) return null;
  try { const p = JSON.parse(Buffer.from(raw, 'base64url').toString()); return p.e > Date.now() ? p.u : null; }
  catch { return null; }
};

// ---------- providers ----------
const PROVIDERS = {
  anthropic: { label: 'Anthropic', type: 'anthropic', models: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
  openai:    { label: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5.2', 'gpt-5.1', 'o4-mini'] },
  deepseek:  { label: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  mistral:   { label: 'Mistral', type: 'openai', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-large-latest', 'mistral-small-latest'] },
  xai:       { label: 'xAI Grok', type: 'openai', baseUrl: 'https://api.x.ai/v1', models: ['grok-4', 'grok-4-fast'] },
  groq:      { label: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile'] },
  ollama:    { label: 'Ollama (your endpoint)', type: 'openai', needsBaseUrl: true, models: [] },
  custom:    { label: 'Custom (OpenAI-compatible)', type: 'openai', needsBaseUrl: true, models: [] },
};
const providerMeta = () => Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) =>
  [k, { label: v.label, models: v.models, needsBaseUrl: !!v.needsBaseUrl }]));

async function callProvider(provider, model, messages, key, baseUrlOverride) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('unknown provider');
  if (p.type === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 1024, messages }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message || `Anthropic error ${r.status}`);
    return (j.content || []).map(b => b.text || '').join('');
  }
  const base = (baseUrlOverride || p.baseUrl || '').replace(/\/$/, '');
  if (!base) throw new Error('Base URL required for this provider');
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, messages }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `${p.label} error ${r.status}`);
  return j?.choices?.[0]?.message?.content || '';
}

// ---------- http helpers ----------
const send = (res, code, obj, headers = {}) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', ...headers });
  res.end(body);
};
const readBody = (req) => new Promise((resolve, reject) => {
  let d = ''; let n = 0;
  req.on('data', c => { n += c.length; if (n > 1e6) { reject(new Error('body too large')); req.destroy(); } d += c; });
  req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { reject(new Error('bad json')); } });
  req.on('error', reject);
});
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
async function serveStatic(res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = rel.replace(/\.\./g, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  const buf = await readFile(file);
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(buf);
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/health') return send(res, 200, { ok: true });
    if (p === '/api/meta') return send(res, 200, { providers: providerMeta() });

    if (p === '/api/register' && req.method === 'POST') {
      const { email, password } = await readBody(req);
      if (!email || !password || password.length < 8) return send(res, 400, { error: 'Email and 8+ char password required' });
      if (db.prepare('SELECT id FROM users WHERE email=?').get(String(email).toLowerCase())) return send(res, 409, { error: 'Account already exists' });
      const id = crypto.randomBytes(8).toString('hex');
      db.prepare('INSERT INTO users(id,email,pass,created) VALUES(?,?,?,?)').run(id, String(email).toLowerCase(), hashPassword(password), Date.now());
      return send(res, 200, { ok: true, email }, { 'set-cookie': cookie(makeSession(id)) });
    }

    if (p === '/api/login' && req.method === 'POST') {
      const { email, password } = await readBody(req);
      const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase());
      if (!u || !verifyPassword(password || '', u.pass)) return send(res, 401, { error: 'Invalid email or password' });
      return send(res, 200, { ok: true, email: u.email }, { 'set-cookie': cookie(makeSession(u.id)) });
    }

    if (p === '/api/logout' && req.method === 'POST')
      return send(res, 200, { ok: true }, { 'set-cookie': 'sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0' });

    // ---- authed routes ----
    const uid = readSession(req);
    if (p.startsWith('/api/') && p !== '/api/meta') {
      if (!uid) return send(res, 401, { error: 'Not signed in' });
    }

    if (p === '/api/me') {
      const u = db.prepare('SELECT email FROM users WHERE id=?').get(uid);
      const rows = db.prepare('SELECT provider, base_url, added FROM keys WHERE user_id=?').all(uid);
      return send(res, 200, { email: u?.email, connected: rows.map(r => ({ provider: r.provider, baseUrl: r.base_url || null, added: r.added })) });
    }

    if (p === '/api/keys' && req.method === 'POST') {
      const { provider, key, baseUrl } = await readBody(req);
      if (!PROVIDERS[provider]) return send(res, 400, { error: 'Unknown provider' });
      if (!key || String(key).length < 8) return send(res, 400, { error: 'Enter a valid API key' });
      if (PROVIDERS[provider].needsBaseUrl && !baseUrl) return send(res, 400, { error: 'Base URL required for this provider' });
      const e = encrypt(String(key));
      db.prepare(`INSERT INTO keys(user_id,provider,iv,tag,ct,base_url,added) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(user_id,provider) DO UPDATE SET iv=excluded.iv,tag=excluded.tag,ct=excluded.ct,base_url=excluded.base_url,added=excluded.added`)
        .run(uid, provider, e.iv, e.tag, e.ct, baseUrl || null, Date.now());
      return send(res, 200, { ok: true });
    }

    if (p.startsWith('/api/keys/') && req.method === 'DELETE') {
      const provider = decodeURIComponent(p.slice('/api/keys/'.length));
      db.prepare('DELETE FROM keys WHERE user_id=? AND provider=?').run(uid, provider);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/chat' && req.method === 'POST') {
      const { provider, model, messages } = await readBody(req);
      const row = db.prepare('SELECT * FROM keys WHERE user_id=? AND provider=?').get(uid, provider);
      if (!row) return send(res, 400, { error: 'No key saved for ' + provider });
      if (!model) return send(res, 400, { error: 'Pick a model' });
      if (!Array.isArray(messages) || !messages.length) return send(res, 400, { error: 'No messages' });
      let key;
      try { key = decrypt({ iv: row.iv, tag: row.tag, ct: row.ct }); }
      catch { return send(res, 500, { error: 'Key decryption failed' }); }
      try {
        const text = await callProvider(provider, model, messages, key, row.base_url);
        return send(res, 200, { text });
      } catch (e) {
        return send(res, 502, { error: e.message || 'Provider call failed' });
      } finally { key = null; }
    }

    // static
    if (req.method === 'GET') return serveStatic(res, p);
    res.writeHead(404); res.end('not found');
  } catch (e) {
    send(res, 500, { error: e.message || 'server error' });
  }
});

const cookie = (v) => `sid=${v}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;

server.listen(PORT, HOST, () => console.log(`alacarte listening on http://${HOST}:${PORT}`));

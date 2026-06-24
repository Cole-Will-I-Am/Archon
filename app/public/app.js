'use strict';

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const api = async (method, path, body) => {
  const r = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data };
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let META = { providers: {} };
let MODE = 'login';
let MESSAGES = [];

/* ===================================================================
   SCREEN ROUTING  (landing → auth → app)
   =================================================================== */
function showScreen(name) {
  $('landing').classList.toggle('hidden', name !== 'landing');
  $('auth').classList.toggle('hidden', name !== 'auth');
  $('app').classList.toggle('hidden', name !== 'app');
  $('nav').classList.toggle('hidden', name !== 'landing');
  if (name !== 'app') window.scrollTo(0, 0);
}
function openAuth(mode) { setMode(mode); showScreen('auth'); $('email').focus(); }

$('nav-signin').onclick = () => openAuth('login');
$('nav-register').onclick = () => openAuth('register');
$('hero-register').onclick = () => openAuth('register');
$('cta-register').onclick = () => openAuth('register');
$('auth-back').onclick = () => showScreen('landing');

/* ===================================================================
   AUTH
   =================================================================== */
function setMode(m) {
  MODE = m;
  $('tab-login').classList.toggle('active', m === 'login');
  $('tab-register').classList.toggle('active', m === 'register');
  $('auth-submit').textContent = m === 'login' ? 'Sign in' : 'Create account';
  $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('auth-error').textContent = '';
}
$('tab-login').onclick = () => setMode('login');
$('tab-register').onclick = () => setMode('register');

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  $('auth-error').textContent = '';
  const email = $('email').value.trim();
  const password = $('password').value;
  const { ok, data } = await api('POST', MODE === 'login' ? '/api/login' : '/api/register', { email, password });
  if (!ok) { $('auth-error').textContent = data.error || 'Something went wrong'; return; }
  $('password').value = '';
  await enterApp();
};

$('logout').onclick = async () => { await api('POST', '/api/logout'); location.reload(); };

/* ===================================================================
   PROVIDERS (key vault)
   =================================================================== */
function fillProviderSelect() {
  const sel = $('prov-select');
  sel.innerHTML = '';
  for (const [id, p] of Object.entries(META.providers)) {
    const o = document.createElement('option');
    o.value = id; o.textContent = p.label;
    sel.appendChild(o);
  }
  toggleBaseUrl();
}
function toggleBaseUrl() {
  const id = $('prov-select').value;
  const needs = META.providers[id]?.needsBaseUrl;
  $('baseurl-wrap').style.display = needs ? 'block' : 'none';
}
$('prov-select').onchange = toggleBaseUrl;

$('save-key').onclick = async () => {
  $('key-error').textContent = '';
  const provider = $('prov-select').value;
  const key = $('apikey').value.trim();
  const baseUrl = $('baseurl').value.trim();
  const { ok, data } = await api('POST', '/api/keys', { provider, key, baseUrl: baseUrl || undefined });
  if (!ok) { $('key-error').textContent = data.error || 'Could not save'; return; }
  $('apikey').value = ''; $('baseurl').value = '';
  await refreshMe();
};

function renderConnected(connected) {
  const box = $('connected');
  box.innerHTML = '';
  if (!connected.length) {
    box.innerHTML = '<div class="none">No keys yet — add one below to start.</div>';
  } else {
    for (const c of connected) {
      const label = META.providers[c.provider]?.label || c.provider;
      const div = document.createElement('div');
      div.className = 'pchip';
      div.innerHTML = `<div><div class="pn">${label}</div>${c.baseUrl ? `<div class="pmeta">${c.baseUrl}</div>` : ''}</div>`;
      const btn = document.createElement('button');
      btn.title = 'Remove'; btn.setAttribute('aria-label', 'Remove ' + label); btn.textContent = '×';
      btn.onclick = async () => { await api('DELETE', '/api/keys/' + encodeURIComponent(c.provider)); await refreshMe(); };
      div.appendChild(btn);
      box.appendChild(div);
    }
  }
  const cp = $('chat-prov');
  const prev = cp.value;
  cp.innerHTML = '';
  if (!connected.length) {
    const o = document.createElement('option'); o.value = ''; o.textContent = 'no providers'; cp.appendChild(o);
  } else {
    for (const c of connected) {
      const o = document.createElement('option');
      o.value = c.provider; o.textContent = META.providers[c.provider]?.label || c.provider;
      cp.appendChild(o);
    }
    cp.value = connected.some(c => c.provider === prev) ? prev : connected[0].provider;
  }
  fillModels();
}

function fillModels() {
  const prov = $('chat-prov').value;
  const dl = $('model-list');
  dl.innerHTML = '';
  const models = META.providers[prov]?.models || [];
  for (const m of models) { const o = document.createElement('option'); o.value = m; dl.appendChild(o); }
  if (models.length && !$('chat-model').value) $('chat-model').value = models[0];
}
$('chat-prov').onchange = () => { $('chat-model').value = ''; fillModels(); };

/* ===================================================================
   CHAT
   =================================================================== */
function addMsg(role, content) {
  const m = $('messages');
  const empty = m.querySelector('.empty'); if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  const label = role === 'user' ? 'you' : role === 'assistant' ? 'assistant' : 'error';
  div.innerHTML = `<div class="role">${label}</div>`;
  const body = document.createElement('div'); body.textContent = content; div.appendChild(body);
  m.appendChild(div);
  m.scrollTop = m.scrollHeight;
  return body;
}
$('clear-chat').onclick = () => { MESSAGES = []; $('messages').innerHTML = '<div class="empty">Cleared. Send a message to start again.</div>'; };

$('chat-form').onsubmit = async (e) => {
  e.preventDefault();
  const provider = $('chat-prov').value;
  const model = $('chat-model').value.trim();
  const text = $('chat-input').value.trim();
  if (!provider) { addMsg('error', 'Add and select a provider first.'); return; }
  if (!model) { addMsg('error', 'Enter a model name.'); return; }
  if (!text) return;
  $('chat-input').value = '';
  addMsg('user', text);
  MESSAGES.push({ role: 'user', content: text });
  const pending = addMsg('assistant', '…');
  $('send').disabled = true;
  const { ok, data } = await api('POST', '/api/chat', { provider, model, messages: MESSAGES });
  $('send').disabled = false;
  if (!ok) {
    pending.parentElement.className = 'msg error';
    pending.parentElement.querySelector('.role').textContent = 'error';
    pending.textContent = data.error || 'Request failed';
    MESSAGES.pop();
    return;
  }
  pending.textContent = data.text || '(empty response)';
  MESSAGES.push({ role: 'assistant', content: data.text || '' });
};

/* ===================================================================
   LANDING: provider menu (live from /api/meta)
   =================================================================== */
function renderProviderMenu() {
  const el = $('provider-menu');
  if (!el) return;
  const entries = Object.entries(META.providers);
  if (!entries.length) { el.innerHTML = '<div class="menu-loading mono">No providers configured.</div>'; return; }
  el.innerHTML = '';
  for (const [, p] of entries) {
    const row = document.createElement('div');
    row.className = 'menu-row';
    const models = (p.models && p.models.length)
      ? p.models.slice(0, 3).join(' · ')
      : (p.needsBaseUrl ? 'any model · your base URL' : 'any model');
    row.innerHTML =
      `<span class="menu-name">${p.label}</span>` +
      `<span class="menu-leader"></span>` +
      `<span class="menu-models">${models}</span>` +
      `<span class="menu-tick">supported</span>`;
    el.appendChild(row);
  }
}

/* ===================================================================
   SIGNATURE: the key vault animation
   =================================================================== */
const HEX = '0123456789abcdef';
const randHex = (n) => Array.from({ length: n }, () => HEX[(Math.random() * 16) | 0]).join('');
const SAMPLE_PREFIXES = ['sk-ant-api03-', 'sk-proj-', 'sk-or-v1-', 'gsk_'];
let vaultAnim = 0;

function sampleKey() {
  const pre = SAMPLE_PREFIXES[(Math.random() * SAMPLE_PREFIXES.length) | 0];
  const b62 = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789';
  const tail = Array.from({ length: 10 }, () => b62[(Math.random() * b62.length) | 0]).join('');
  return pre + tail + '…';
}

function lockVault() {
  const fields = [
    { el: $('vault-iv'),  len: 24 },   // 12-byte IV
    { el: $('vault-tag'), len: 32 },   // 16-byte GCM tag
    { el: $('vault-ct'),  len: 48 },   // ciphertext (truncated by CSS)
  ];
  if (fields.some(f => !f.el)) return;
  $('vault-plain').textContent = sampleKey();
  const targets = fields.map(f => randHex(f.len));

  if (reduceMotion) { fields.forEach((f, i) => f.el.textContent = targets[i]); return; }

  const token = ++vaultAnim;
  const start = performance.now();
  const DUR = 900;
  (function frame(now) {
    if (token !== vaultAnim) return;
    const t = Math.min(1, (now - start) / DUR);
    const eased = 1 - Math.pow(1 - t, 2);
    fields.forEach((f, i) => {
      const reveal = Math.floor(eased * f.len);
      const fin = targets[i].slice(0, reveal);
      const scr = randHex(f.len - reveal);
      f.el.textContent = fin + scr;
    });
    if (t < 1) requestAnimationFrame(frame);
  })(start);
}
$('vault-relock').onclick = lockVault;

/* ===================================================================
   Scroll reveal
   =================================================================== */
function initReveal() {
  if (reduceMotion || !('IntersectionObserver' in window)) return;
  const targets = document.querySelectorAll('.section-head, .step, .menu, .sec-card, .cta-wrap');
  targets.forEach(t => t.classList.add('reveal'));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  targets.forEach(t => io.observe(t));
}

/* ===================================================================
   BOOT
   =================================================================== */
async function refreshMe() {
  const { ok, data } = await api('GET', '/api/me');
  if (!ok) return false;
  $('who').textContent = data.email || '';
  renderConnected(data.connected || []);
  return true;
}
async function enterApp() {
  const signedIn = await refreshMe();
  if (signedIn) showScreen('app');
  else { showScreen('auth'); setMode('login'); }
}
async function boot() {
  const meta = await api('GET', '/api/meta');
  META = meta.data || { providers: {} };
  fillProviderSelect();
  renderProviderMenu();
  lockVault();
  initReveal();

  const signedIn = await refreshMe();
  if (signedIn) showScreen('app');
  else showScreen('landing');
}
boot();

'use strict';
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

let META = { providers: {} };
let MODE = 'login';
let MESSAGES = [];

// ---------- auth ----------
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
  await boot();
};

$('logout').onclick = async () => { await api('POST', '/api/logout'); location.reload(); };

// ---------- providers ----------
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
    box.innerHTML = '<div class="none">No keys yet — add one below.</div>';
  } else {
    for (const c of connected) {
      const label = META.providers[c.provider]?.label || c.provider;
      const div = document.createElement('div');
      div.className = 'pchip';
      div.innerHTML = `<div><div class="pn">${label}</div>${c.baseUrl ? `<div class="pmeta">${c.baseUrl}</div>` : ''}</div>`;
      const btn = document.createElement('button');
      btn.title = 'Remove'; btn.textContent = '×';
      btn.onclick = async () => { await api('DELETE', '/api/keys/' + encodeURIComponent(c.provider)); await refreshMe(); };
      div.appendChild(btn);
      box.appendChild(div);
    }
  }
  // chat provider select = connected only
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

// ---------- chat ----------
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

// ---------- boot ----------
async function refreshMe() {
  const { ok, data } = await api('GET', '/api/me');
  if (!ok) return false;
  $('who').textContent = data.email || '';
  renderConnected(data.connected || []);
  return true;
}
async function boot() {
  const meta = await api('GET', '/api/meta');
  META = meta.data || { providers: {} };
  fillProviderSelect();
  const signedIn = await refreshMe();
  if (signedIn) { $('auth').classList.add('hidden'); $('app').classList.remove('hidden'); }
  else { $('app').classList.add('hidden'); $('auth').classList.remove('hidden'); setMode('login'); }
}
boot();

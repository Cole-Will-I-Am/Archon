# à la carte — MVP control plane

A dependency-free Node web app: sign in, add your own AI provider API keys (encrypted at rest), and chat through them. This is the BYOK control plane's core — auth + key vault + model routing.

## Requirements

- Node **>= 22.5** (uses the built-in `node:sqlite` module — no native deps, no `npm install`)

## Run

```bash
cp .env.example .env
# generate real secrets:
node -e "console.log('MASTER_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('COOKIE_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
# put those into .env, then:
npm start          # === node server.mjs
```

Open http://127.0.0.1:8123. Create an account, add a provider key, pick a model, chat.

## Environment

| Var | Purpose |
|-----|---------|
| `MASTER_KEY` | 64 hex chars (32 bytes). AES-256-GCM master key that encrypts stored provider keys. **Keep secret; losing it makes stored keys unrecoverable.** |
| `COOKIE_SECRET` | Random hex string. Signs the session cookies. |
| `PORT` | Default `8123`. Binds to `127.0.0.1`. |

## How it works

- **Auth** — email + password (scrypt). Sessions are stateless HMAC-signed `HttpOnly` cookies.
- **Key vault** — each provider key is encrypted with AES-256-GCM (random IV per key) before going into SQLite. The DB stores only `{iv, tag, ciphertext}` — never the raw key.
- **Routing** — on a chat request: look up the user's key for the chosen provider → decrypt in memory → call the provider → return the reply. Anthropic uses the native Messages API; everyone else uses the OpenAI-compatible `/chat/completions` shape.

### Providers

Anthropic (native) plus any OpenAI-compatible endpoint: OpenAI, DeepSeek, Mistral, xAI, Groq, **Ollama** (your own endpoint), or a custom base URL. Model dropdowns are seeded with suggestions; any model name can be typed.

## Data

SQLite at `data/alacarte.db` (git-ignored). Two tables: `users`, `keys`.

## Deploy

`deploy/` has a systemd unit and a cloudflared tunnel example. The live instance runs as two services on the VPS:

- `alacarte.service` — the Node app on `127.0.0.1:8123`
- `alacarte-tunnel.service` — a dedicated Cloudflare tunnel exposing it over HTTPS (no open firewall ports)

## Status / not-yet

MVP. Open registration, master key on-box, non-streaming responses, no Vertex/Gemini yet. See the repo `ROADMAP.md` for hardening and the production (Cloudflare edge) path.

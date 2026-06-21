# Archon

Home for the roadmap, architecture, and working code behind **manticthink — à la carte**: a bring-your-own-key (BYOK) platform where people log in, plug in their own AI provider keys, and compose AI services (model routing, RAG, custom MCPs, orchestration) — paying their own providers directly.

It grows out of a larger idea: turning a small VPS into **an autonomous software studio you talk to** — text it an idea, get back built, tested, shipped software (web *and* native iOS).

---

## Status

| Piece | State |
|-------|-------|
| à la carte MVP control plane (auth + encrypted BYOK key vault + multi-provider chat) | **Live** — running on the VPS, served over HTTPS via a dedicated Cloudflare tunnel |
| Edge control plane on Cloudflare (Workers / D1 / AI Gateway) | planned |
| Sandbox / job plane (per-tenant sandboxes, custom MCP runtime, job runner, RAG) | partially exists on the VPS |
| Burst compute (Lambda GPU, Vertex) | to wire |

The MVP is the **edge control plane's core** (auth, key vault, model routing) running on the VPS for now. In production that part moves to Cloudflare; the VPS becomes the sandbox/job plane.

---

## What's in this repo

```
Archon/
├── README.md                     you are here
├── ROADMAP.md                    phases, built vs to-build
├── docs/
│   ├── architecture.md           target-state + split-plane deployment (with diagrams)
│   └── byok-and-compliance.md    why BYOK, not Claude-subscription routing (with sources)
└── app/                          the working MVP
    ├── server.mjs                dependency-free Node server (auth, AES-256-GCM vault, routing)
    ├── public/                   single-page front end (index.html, styles.css, app.js)
    ├── deploy/                   systemd unit + cloudflared tunnel example
    ├── .env.example              required secrets (generate your own)
    └── package.json
```

---

## The idea in one breath

A request (a chat message) enters one pipeline and comes out as shipped software:

```
idea ── GATE ── SPEC ── BUILD ── TEST ── SHIP ── live web app + GitHub repo + iOS build
```

The platform is **BYOK**: every model call uses the *user's own* key, billed to them. The platform charges for software value, not tokens. Identity is standard sign-in — **not** "log in with Claude" (Anthropic doesn't permit using consumer subscriptions to power third-party apps; see `docs/byok-and-compliance.md`).

Deployment splits into three planes:

- **Edge control plane (Cloudflare)** — web app, auth, the encrypted key vault, model routing (AI Gateway), billing.
- **Sandbox / job plane (the VPS)** — per-tenant sandboxes for untrusted/custom code, long jobs, RAG, local models. Connected to the edge by a Cloudflare tunnel (no open ports).
- **Burst compute** — Lambda GPU / Vertex, spun up on demand for training and big batches.

See `docs/architecture.md` for the full picture and `ROADMAP.md` for what's built vs. what's next.

---

## Run the MVP

See [`app/README.md`](app/README.md). Short version:

```bash
cd app
cp .env.example .env      # then fill in real MASTER_KEY and COOKIE_SECRET
npm start                 # node server.mjs  (Node >= 22.5, uses built-in SQLite)
```

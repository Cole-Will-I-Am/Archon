# Roadmap

Status legend: ✅ built · 🟡 partial / exists on the VPS · ⬜ to build · 🔌 to wire

---

## Phase 0 — MVP control plane (current)

The à la carte website, running on the VPS and reachable over HTTPS.

- ✅ Accounts: register / sign in (scrypt-hashed passwords, HMAC-signed `HttpOnly` session cookies)
- ✅ BYOK key vault: add keys per provider, **encrypted at rest with AES-256-GCM** (DB only ever holds ciphertext)
- ✅ Multi-provider chat: Anthropic (native Messages API) + any OpenAI-compatible provider (OpenAI, DeepSeek, Mistral, xAI, Groq, Ollama, custom base URL). Lookup → decrypt → call with the user's key.
- ✅ Deploy: `alacarte.service` (Node, `127.0.0.1:8123`) + `alacarte-tunnel.service` (dedicated Cloudflare tunnel, isolated from production tunnels, no firewall changes)

### Phase 0 hardening (next, before opening it up)
- ⬜ Close open registration (allowlist, invite codes, or Cloudflare Access in front for a private beta)
- ⬜ Move the master key off-box to a KMS / envelope encryption
- ⬜ Key rotation + revocation UI
- ⬜ Streaming responses
- ⬜ Rate limiting per user

---

## Phase 1 — Edge control plane (Cloudflare)

Move the user-facing + credential-handling layer to the edge.

- ⬜ Web app on Pages / Workers (dashboard + service catalog)
- ⬜ Data: D1 (app data), KV (sessions), R2 (blobs)
- ⬜ BYOK key vault on D1 with envelope encryption / KMS
- ⬜ **AI Gateway** for BYOK model routing (per-provider keys, caching, rate-limit, logging, fallback)
- ⬜ Auth: Google / GitHub / email (identity only)
- ⬜ Billing: Stripe — charge for software, not tokens
- ⬜ Async: Durable Objects, Queues, Workflows

---

## Phase 2 — Sandbox / job plane (the VPS)

The half that the edge can't do: untrusted code and long jobs.

- ✅ Per-tenant sandboxes (Linux user + apparmor + egress filter) — already on the VPS
- 🟡 Custom MCP runtime — run users' MCP servers inside sandboxes (partially via the existing aibuilder platform)
- ⬜ Job / phase runner — builds, indexing, long tasks (GATE → SPEC → BUILD → TEST → SHIP)
- ⬜ RAG store (Chroma / Qdrant) — corpus-grounded apps
- ✅ Local Ollama (small models), GitHub (authed), Cloudflare tunnel, iOS toolchain (XcodeGen + Swift)

---

## Phase 3 — Burst compute

- 🔌 Lambda GPU (GH200) — train / fine-tune / large-batch inference
- 🔌 Google Vertex AI — managed tuning + custom jobs, Gemini, batch prediction

---

## Phase 4 — The spine (makes it safe to let outsiders in)

The connective tissue. Most of these existed on a prior machine and are worth porting.

- ⬜ Persistent, shared cross-agent memory standard
- ⬜ Ops log: decisions / actions / evidence / red-team / reviews (one auditable standard across the platform)
- ⬜ Integrity / tamper monitoring + immutable critical configs + alerting (the Telegram bots can carry alerts)
- ⬜ Full audit trail

---

## Two burdens that gate "open to others"

1. **Key custody** — encrypt at rest (done), but also: master key in a KMS, never logged, rotation + revocation. A leaked key spends users' money.
2. **Untrusted code** — every custom MCP is arbitrary code execution; it only ever runs inside a per-tenant sandbox, never on the host.

The moment outsiders are in, Phase 4 (integrity + audit) stops being optional.

---

## Hardware note

The current VPS is **1 vCPU / 3.8 GB RAM**. Compute is cloud-routed (the box orchestrates, it doesn't crunch), so CPU is fine — but **RAM is the ceiling**: it caps how many sandboxed builds run concurrently. For real traffic, size up the sandbox/job plane or move it to a container host (Fly / Railway / a bigger box).

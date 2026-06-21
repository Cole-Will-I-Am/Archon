# Architecture

Two views: the **target-state** (what the platform is becoming) and the **split-plane deployment** (where each piece runs). Polished PDF versions of both diagrams exist outside the repo and can be added on request.

---

## 1. Target state — an autonomous software studio you talk to

A request (a chat message) enters one pipeline and comes out as shipped software.

```
        FRONT DOORS   (reach it from anywhere)
   Telegram | SMS | Matrix | web chat (*.manticthink.com) | MCP (direct)
                             |
                             v
   [1] FOREMAN  — intake, routing, job state
       phase pipeline:  GATE -> SPEC -> BUILD -> TEST -> SHIP
       model router · task queue · per-tenant quotas
                             |
        +--------------------+--------------------+
        v                                         v
   [2] THE WORKFORCE                         [3] REMOTE COMPUTE & TRAINING
   cloud brains (heavy, routed):             Lambda GPU (GH200): train / batch
     deepseek-v4 · nemotron-3 · qwen3.5      Google Vertex: tuning · Gemini · batch
     kimi-k2.7 · minimax-m3                  (escalate compute -> ; weights return)
   local role-team (on box):
     ecnyss-{architect,planner,coder,
     redteam,maintainer} · str-* · babel
                             |
                             v
   [4] FACTORY FLOOR  — sandboxed build & run
       per-tenant Linux users (apparmor + egress filter)
       web (Node/React) · API (Py/FastAPI) · Rust · NATIVE iOS (XcodeGen + Swift)
                             |
                             v
   [5] LOADING DOCK  — ship it for real
       GitHub: repo · commit · push · CI
       web:  Caddy + Cloudflare tunnel -> live *.manticthink.com
       iOS:  XcodeGen -> .ipa -> TestFlight
                             |
                             v
   SHIPPED:  live web app  +  GitHub repo  +  iOS build   (from one message)

   THE SPINE (the gap to close): persistent memory · ops log
     (decisions/actions/evidence/red-team) · integrity + immutable configs · audit trail

   SUBSTRATE (already running): onweald · terrarium · logos relay · ollama gateway · tailscale
```

Most of layers 1–5 already exist in scattered form on the VPS. The missing piece is mostly **the spine** — the connective tissue that makes it reliable and safe to let other people in.

---

## 2. Split-plane deployment (the BYOK product)

Where each piece actually runs. Neither "all VPS" nor "all Cloudflare" — different parts want different homes.

```
  THE USER
    sign in: Google / GitHub / email            (identity only - NOT "log in with Claude")
    bring keys: Anthropic · OpenAI · Vertex · xAI · Mistral · Ollama   (billed to the user)
                             |
                             v
  ===================================================================
  PLANE 1 — EDGE CONTROL PLANE              [ Cloudflare ]
    web app (Pages/Workers) · API · auth · billing (Stripe)
    BYOK key vault (AES-GCM in D1, envelope/KMS, never logged)
    AI Gateway — BYOK model routing: cache · rate-limit · logs · fallback
    data: D1 / KV / R2 · async: Durable Objects / Queues / Workflows
       |                                            \
       |  model calls -> provider (with user's key)  \  heavy work + untrusted code
       |  Anthropic/OpenAI/Vertex/xAI/Mistral         \  via Cloudflare Tunnel
       v                                               v
  ===================================================================
  PLANE 2 — SANDBOX / JOB PLANE             [ the VPS ]   (no open ports)
    per-tenant sandboxes (Linux user + apparmor + egress)   [built]
    custom MCP runtime (run users' MCP servers)             [partial]
    job / phase runner (GATE->...->SHIP)                    [to build]
    RAG store (Chroma/Qdrant)                               [to add]
    local Ollama · GitHub · Cloudflare tunnel · iOS         [built]
                             |
                             v   GPU bursts, on demand
  ===================================================================
  PLANE 3 — BURST COMPUTE                   [ on demand ]
    Lambda GPU (GH200): train / fine-tune / large-batch
    Google Vertex AI: managed tuning · Gemini · batch prediction
```

### How a request travels (the edge decides)

```
model call?     User -> Edge (auth + pick service) -> AI Gateway + your key -> provider -> back
build/mcp/rag?  User -> Edge -> Tunnel -> Sandbox plane -> Burst (if GPU) -> results -> Edge -> User
```

### Why this split

- The edge **can't** run arbitrary binaries (Workers are JS/WASM isolates) or long jobs (execution limits) — so untrusted custom MCPs and builds live on the VPS, which already has the per-tenant sandbox model.
- The VPS **shouldn't** be the public front door for a multi-user product (1 vCPU / 3.8 GB; RAM-bound). The edge handles auth, the key vault, routing, and billing globally and cheaply.
- Model inference doesn't need the VPS at all — it goes straight from the edge to the provider on the user's key.

---

## Current MVP vs. this target

The MVP in `app/` is the **edge control plane's core** (auth + BYOK vault + model routing) running on the VPS instead of Cloudflare, for speed of getting something real. The migration path: move `app/` logic to Workers + AI Gateway, keep the VPS as Plane 2.

# BYOK & compliance

Why the platform is **bring-your-own-key (BYOK)** and **not** "log in with Claude and run on the user's subscription."

## The constraint

The original idea was: users log in with Claude and the platform runs services on their Claude subscription. That specific model is **not allowed**, and Anthropic actively enforces against it.

- Anthropic's Help Center states subscription plans (Free / Pro / Max / Team / Enterprise) are meant to support ordinary use of **native Anthropic apps** (Claude web, desktop, mobile, and Claude Code) — and that **if you're building a product for others, you should use API-key authentication via the Console**. Third-party tools that route traffic against subscription limits are prohibited and may be enforced against.
  - https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account
- There is **no general "Sign in with Claude"** identity provider for third-party websites. The only subscription-tied token (Claude Code's `setup-token`) only works with Claude Code and is rejected by the Messages API.
- Anthropic has enforced this in practice — cracking down on "harnesses" that pilot a user's web Claude account via OAuth, severing the link between flat-rate consumer plans and external tools.
  - https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses

## The compliant model: BYOK

Reframed slightly, the whole product survives:

- Each user provides their **own API key** for each provider and has a **direct billing relationship** with that provider.
- The platform stores keys securely and uses them per-request. It charges for **software value**, not tokens.
- This is the standard, paved path — Warp, Vercel AI Gateway, and others do exactly this (add your own Anthropic / OpenAI / Google keys; requests route through them).

So:

- **Identity** = normal sign-in (Google / GitHub / email). Not a Claude login.
- **Model access** = the user's own key for each provider (including their own Anthropic Console key).
- **Billing** = the platform bills for the software; providers bill the user for usage.

## What this means for the build

- Store provider keys encrypted at rest (the MVP uses AES-256-GCM; production should add a KMS / envelope encryption), never log them, and provide rotation + revocation.
- Refactor every model call to **lookup → decrypt → call with the user's key** (this is what `app/server.mjs` does).
- Never proxy third-party traffic through a single shared subscription or a single platform-owned key on behalf of unrelated end users.

> Terms change. Re-read Anthropic's Terms of Service and Acceptable Use Policy (and OpenAI's / Google's) directly before launch, and periodically after.

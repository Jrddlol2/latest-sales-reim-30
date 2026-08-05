# Production cutover punch-list

Single burn-down list of everything that must be done before deploying **with real
employee, client, or financial data**. Consolidates the README's "Do not deploy
with real data until…" checklist, the Known-limitations register, and the current
`npm audit` state.

- **Status as of 2026-08-05:** ✅ ready as a demo / pilot (in-memory or Postgres,
  demo login). ❌ **not** ready for real data — blocked on authentication.
- **Health baseline:** 87/87 vitest pass · `tsc --noEmit` clean · `npm run build` clean.
- **Hosting rule:** deploy to a persistent-process host (Render / Railway / Fly.io).
  **Do NOT** deploy to Vercel serverless — the in-memory-cache + write-through design
  needs one continuous process (README → Database persistence).

Legend: 🔴 blocker · 🟠 high · 🟡 medium · 🟢 low/nice-to-have · ✅ done

---

## 🔴 Blockers — real data cannot ship until these are done

| # | Item | Where | Notes |
|---|------|-------|-------|
| 1 | **Replace demo `X-User-Id` identity with real auth** | `server.ts` (~935, ~1005) | Client-supplied header = anyone can impersonate any role. Single largest gap. |
| 2 | **Implement Microsoft Entra OIDC + server-side sessions** | `server.ts` auth routes; `docs/project-handoff/MICROSOFT-AUTH-HANDOFF.md` | Auth-code flow w/ PKCE, state, nonce, issuer/aud/signature validation; map Entra `oid` → internal user. Blocked on IT supplying tenant/client/secret/redirect. |
| 3 | **Remove `X-User-Id` trust + demo account access** | `server.ts`, demo login UI | Do after #2 lands. |
| 4 | **Set production env flags** | host env | `DEMO_MODE=false`, `AUTH_MODE=microsoft`, `ENABLE_DEMO_LOGIN=false`, `VITE_ENABLE_DEMO_LOGIN=false`, `AUTO_SEED=false`. |
| 5 | **Apply DB migrations to the live database** | `drizzle/0000`–`0005` | Live Supabase drifted behind schema (missing `0004` claim_number_seq / `0005`). Claim creation 500s in DB mode until applied. Confirm with owner before running against shared data. |

## 🟠 High — do before or immediately alongside cutover

| # | Item | Where | Notes |
|---|------|-------|-------|
| 6 | **Remediate `react-router` HIGH CVE** | `react-router` / `react-router-dom` | GHSA-qwww-vcr4-c8h2 (RSC-mode CSRF bypass). App isn't in RSC mode so exposure is low, but patch before production. No clean forward fix at README-time; re-check for a patched release. |
| 7 | **Durable upload storage + per-object authorization** | upload routes, `uploads/` | Local FS isn't persistent (lost on restart/redeploy); downloads not authorized against owning claim/MOM. Move to object storage. |
| 8 | **Real email/notification provider** | outbox/email code | Currently mock; not delivered, not persisted. Wire an approved provider. |
| 9 | **Harden release codes** | release-code logic | Cryptographic + persisted, but plaintext, no expiry, unlimited attempts. Add hashing, expiry, attempt throttling. |
| 10 | **Collapse demo-seed gating** | `seedYearOfData()` | Only runs under `DEMO_MODE=true` (safe today), but fold into one switch so real deploys can never regenerate. |

## 🟡 Medium — hardening / correctness before scale

| # | Item | Where | Notes |
|---|------|-------|-------|
| 11 | **Wrap multi-step writes in Postgres transactions** | claim submission (claim + expenses + MOM) | Sequential awaited upserts; a mid-sequence failure leaves a partial write. Each `persist*()` is individually valid, so it's durability, not corruption. |
| 12 | **Formal server-side authorization audit** | route/UI scoping | Reimbursement transition guards added; full server-side policy review still owed. |
| 13 | **Remediate `esbuild` MODERATE CVE (dev-only)** | via `drizzle-kit` → `@esbuild-kit/*` | GHSA-67mh-4wv8-2f99, dev-server only, not in the shipped bundle. Fix needs a breaking `drizzle-kit` bump — schedule deliberately. |
| 14 | **Enable TypeScript strict mode** | `tsconfig.json` | Green lint ≠ runtime correctness today. |
| 15 | **Server-side search for large data** | workspace search | Client-side is fine for demo volume only. |
| 16 | **Backups, migration ownership, retention, restore testing** | DB ops | Supabase PITR (paid tier) or own backup job. |
| 17 | **Logs / monitoring / error tracking / incident ownership** | ops | Rate limiting, Helmet CSP, and pino structured logs already added — review CSP + add monitoring/error tracking + on-call. |

## 🟢 Low

| # | Item | Notes |
|---|------|-------|
| 18 | Historical import / `import_batches` | Controlled admin prototype; not persisted yet. Treat as evolving. |
| 19 | Privacy / audit-retention / financial-control / UAT reviews | Complete before go-live sign-off. |

---

## Already done (was previously listed as a blocker)

- ✅ **PostgreSQL persistence** — `server.ts` runs against Supabase Postgres via Drizzle (25-table schema). (2026-08-04)
- ✅ **`jspdf` critical CVE** — upgraded 3.0.3 → **4.2.1**; no longer in `npm audit`. (README's CVE table is stale on this point.)
- ✅ **Rate limiting, Helmet CSP, pino structured logging** — added in the production-hardening commit.
- ✅ **Cryptographic release-code generation + Postgres persistence** (hashing/expiry still pending — see #9).

## Current `npm audit` (2026-08-05)

`6 vulnerabilities (4 moderate, 2 high)` — **no critical**.
- HIGH: `react-router` / `react-router-dom` (#6)
- MODERATE: `esbuild` via `drizzle-kit` dev toolchain (#13) — dev-only, not shipped.

Do **not** run `npm audit fix --force` blindly (it downgrades). After any dependency
change, re-run `npm run lint && npm test && npm run build` and manually verify PDF
export and routing.

## Verify after each change

```bash
npm run lint && npm test && npm run build
```

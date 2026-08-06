# Production cutover punch-list

Single burn-down list of everything that must be done before deploying **with real
employee, client, or financial data**. Consolidates the README's "Do not deploy
with real data until…" checklist, the Known-limitations register, and the current
`npm audit` state.

- **Status as of 2026-08-06:** ✅ ready as a demo / pilot (in-memory or Postgres,
  demo login). ❌ **not** ready for real data — blocked on authentication.
- **Health baseline:** 89/89 vitest pass · `tsc --noEmit` clean · `npm run build` clean.
- **Note:** migration `0006` (release-code hardening columns, see #9) is also
  unapplied against the live Supabase DB — same gap as #5, folded into that item.
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
| 5 | **Apply DB migrations to the live database** | `drizzle/0000`–`0006` | Live Supabase drifted behind schema (missing `0004` claim_number_seq / `0005` / `0006`). Claim creation 500s in DB mode until applied. Confirm with owner before running against shared data. |

## 🟠 High — do before or immediately alongside cutover

| # | Item | Where | Notes |
|---|------|-------|-------|
| 6 | **Remediate `react-router` HIGH CVE** | `react-router` / `react-router-dom` | GHSA-qwww-vcr4-c8h2 (RSC-mode CSRF bypass). App isn't in RSC mode so exposure is low, but patch before production. No clean forward fix as of 2026-08-06 (latest 7.18.2 is still in the vulnerable 7.12.0–8.2.0 range; `npm audit fix --force` would downgrade, not fix) — re-check for a patched release. |
| 7 | **Durable upload storage** | upload routes, `uploads/` | Local FS isn't persistent (lost on restart/redeploy). Move to object storage (S3/GCS/Azure Blob) — needs a provider decision + credentials. Per-object *authorization* is already done (`GET /uploads/:filename` in `server.ts` resolves each file back to its owning claim/MOM/liquidation and applies that record's own access predicate) — corrected 2026-08-06, this item previously implied that part was still open. |
| 8 | **Real email/notification provider** | outbox/email code | Currently mock; not delivered, not persisted. Wire an approved provider. |

## 🟡 Medium — hardening / correctness before scale

| # | Item | Where | Notes |
|---|------|-------|-------|
| 12 | **Formal server-side authorization audit** | route/UI scoping | Reimbursement transition guards added; full server-side policy review still owed. |
| 13 | **Remediate `esbuild` MODERATE CVE (dev-only)** | via `drizzle-kit` → `@esbuild-kit/*` | GHSA-67mh-4wv8-2f99, dev-server only, not in the shipped bundle. Fix needs a breaking `drizzle-kit` bump (0.31 → 1.0.0-rc, prerelease as of 2026-08-06) — schedule deliberately, re-test `db:generate`/`db:push` against it before adopting. |
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
- ✅ **Cryptographic release-code generation + Postgres persistence, now with expiry and attempt throttling** (2026-08-06). Plaintext storage is a deliberate tradeoff, not an oversight — custodians re-display the code later in the Ready-for-Claim queue and Payouts history to read it back to a requestor, which a one-way hash would break. `RELEASE_CODE_VALIDITY_DAYS` (14d), `RELEASE_CODE_MAX_ATTEMPTS` (5), `RELEASE_CODE_LOCKOUT_MINUTES` (15) in `server.ts`; confirm compares with `crypto.timingSafeEqual`. Migration `0006` adds the new columns (unapplied on the live DB — folded into #5).
- ✅ **Multi-step claim writes now transactional** (2026-08-06) — `persistClaimWithLineItems()` in `src/db/coreLoopRepo.ts` wraps the claim + expense line items + MOM backfill in one `db.transaction()` for new-claim submission, resubmission, and the cash-advance-shortfall auto-claim. (The liquidation-review route's claim/cash-advance/liquidation write still spans two repo modules and wasn't folded in — flagged as a follow-up, not attempted here.)
- ✅ **Demo-seed gating collapsed to one switch** (2026-08-06) — `seedYearOfData()` itself now throws if `DEMO_MODE` is disabled, as a backstop under the existing per-route 404 checks, so a future call site can't accidentally reseed a real deployment.
- ✅ **TypeScript strict mode** (2026-08-06) — `tsconfig.json` now sets `strict: true` (previously only `strictNullChecks`/`noImplicitAny`). Verified in isolation first: zero new errors, since those two flags already covered most of what `strict` adds. `tsc --noEmit`, 89/89 tests, and build all still clean.

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

# Cross-Cutting Concerns

Four concerns cut across every feature in better-agent: at-rest encryption of secrets, the typed RPC framework that every client and server procedure speaks, structured logging, and the Drizzle ORM layer with its no-raw-SQL guard. This document covers the shared infrastructure they provide.

## Architecture

```
apps/server/src/services.ts  (composition root)
  │
  ├─ getSecretBox()  ──▶ createSecretBox(env.CREDENTIALS_SECRET)  [memoized per isolate]
  │       └─ injected into every store that touches an encrypted column
  │
  ├─ buildServices(db, …) ─▶ { stores, runtime, modelFactory, catalog, … }
  │       └─ createXStore(db, secretBox) for each repository
  │
  └─ app.ts (HTTP wiring)
        ├─ createContext({ context, services })   [per-request]
        ├─ RPCHandler(appRouter) + OpenAPIHandler(appRouter)
        ├─ evlog() middleware (skipped on streaming paths)
        ├─ onError → log.error + CORS re-apply
        └─ /rpc, /api-reference, /mcp/memory, /bridge/…/stream, /internal/authz-invalidate
```

The server is composed once at boot (`buildServices`) with concrete implementations of every store and collaborator, then `buildApp` wires that service bag into Hono middleware + the oRPC handlers. Every request rebuilds a `Context` that resolves auth from the bearer token and threads the service bag through, so procedures are pure functions of `(input, context)`.

## Key Files

| File | Responsibility |
|------|----------------|
| `packages/agent/src/crypto/secret-box.ts` | `createSecretBox` — AES-256-GCM seal/open with scrypt key derivation |
| `packages/api/src/index.ts` | Procedure builders: `publicProcedure`, `agentProcedure`, `bridgeProcedure`, `userProcedure`, `adminProcedure`, `authorizedUserProcedure` |
| `packages/api/src/context.ts` | `createContext` — bearer token dispatch (JWT / agent token / bridge token), `clientIp`, `waitUntil` |
| `packages/api/src/routers/index.ts` | `appRouter` — composes all 16 sub-routers into one typed contract |
| `apps/server/src/services.ts` | Composition root: `buildServices(db, …)` — memoized SecretBox, provider deps, Redis/Upstash/in-memory store selection |
| `apps/server/src/app.ts` | HTTP wiring: CORS, evlog, oRPC RPC + OpenAPI handlers, bridge SSE, internal routes |
| `packages/db/src/schema/index.ts` | Barrel re-export of every Drizzle schema module |
| `packages/db/src/schema/*.ts` | Table definitions (agents, sessions, auth, bridge, memory, providers, usage, …) |
| `packages/db/src/repositories/*.ts` | Repository pattern: `createXStore(db, …)` factories, one per aggregate |
| `scripts/check-no-raw-sql.js` | Pre-commit guard: rejects `sql\`…\`` tag templates in `packages/db/` |
| `lefthook.yml` | Git hooks: format, lint, file-rules, no-raw-sql, eslint, package-json, tailwind, type-check, conventional commits |

## Data Flow

### Encryption (SecretBox)

`createSecretBox(secret)` (`packages/agent/src/crypto/secret-box.ts:18`) derives a 32-byte key from the caller-supplied `secret` (e.g. `env.CREDENTIALS_SECRET`) via `scryptSync` with a fixed salt, then returns `{ encrypt, decrypt }`:

- **`encrypt(plaintext)`** — generate a fresh 12-byte IV (`IV_LENGTH = 12`), `createCipheriv("aes-256-gcm", key, iv)`, encrypt, pull the auth tag, and return the colon-joined payload `ivHex:tagHex:dataHex`.
- **`decrypt(payload)`** — split on `:` (must yield exactly iv/tag/data), rebuild the decipher, `setAuthTag`, decrypt. A wrong key, a tampered payload, or a truncated payload throws.

GCM's auth tag means any modification to the payload (or the wrong key) fails the `decipher.final()` — there is no silent corruption. The 12-byte IV is randomized per encryption, so identical plaintexts produce different ciphertexts.

The `secret` is `env.CREDENTIALS_SECRET`. The server memoizes one `SecretBox` per isolate (`services.ts:63` `cachedSecretBox`) because `scryptSync` is deliberately slow; re-deriving on every call would be wasteful. The same instance is injected into every store that has an encrypted column — `agentStore` (agent tokens), `providerCredential` (API keys), `settingsStore`, `composioAccountStore`, `mcpServerStore`.

### oRPC framework

oRPC is the typed RPC layer. The server router is a plain object of procedures, composed in `packages/api/src/routers/index.ts:19`:

```
appRouter = {
  healthCheck, auth, account, activity, admin, bridge, composio,
  invite, mcp, memory, providers, agents, sessions, usage, userSessions
}
```

`AppRouter = typeof appRouter` is the single source of truth for the contract. `RouterClient<AppRouter>` (`@orpc/server`) is the typed client type — the SDK (`packages/client`), the web app, and the admin app all build their oRPC clients against it, so an input shape change is a compile error everywhere.

**Procedure builders** (`packages/api/src/index.ts`) layer auth middleware:

| Builder | Gate |
|---------|------|
| `publicProcedure` | None |
| `agentProcedure` | `authedAgent` (agent token `ba_…`) |
| `bridgeProcedure` | `authedBridgeToken` (`bt_…`) |
| `userProcedure` | `requireActiveUser` — JWT user, not blocked |
| `adminProcedure` | `userProcedure` + `isAdminEmail`/`isAdmin` |
| `authorizedUserProcedure` | `userProcedure` + invite/authz gate (staff bypass) |

`requireActiveUser` (`index.ts:34`) is the live-block check: it re-reads the user row on every request and rejects blocked users with FORBIDDEN, so blocking takes effect immediately (no token denylist needed).

**Link interceptors** on the client side add cross-cutting behavior. The admin's oRPC client (`apps/admin/src/utils/orpc.ts`) has a refresh interceptor: on UNAUTHORIZED, attempt one `auth.refresh` (deduped via `refreshInFlight`), retry the original call on success, redirect to `/login` on failure.

**TanStack Query integration** is via `createTanstackQueryUtils(client)` → `orpc.<router>.<proc>.queryOptions({ input })` / `mutationOptions(…)`, giving every procedure typed query keys and results with zero boilerplate.

**Streaming endpoints** skip the logging middleware (`apps/server/src/app.ts:25` `STREAMING_PATHS`) because it buffers the response body, which locks the `ReadableStream` and breaks SSE/turn streams. The RPC handler returns the handler's `Response` directly (`app.ts:104`) for the same reason — re-wrapping attaches a second reader.

### Evlog logging

`evlog` is the structured logging library. `app.ts:69` applies `evlog()` as middleware on every non-streaming path, emitting one wide event per request. `onError` (`app.ts:52` in the RPC handler interceptors, and `app.ts:80` on the Hono app) calls `log.error({ error })` so thrown errors are captured with their stack and context.

The wide-event shape means each log entry is a self-contained record (request id, path, status, duration, error) rather than a free-form string — making logs grep-able and suitable for the file-drain pipeline evlog ships. The error handler is wired in two places (the oRPC handler's `onError` interceptor and Hono's `app.onError`) so errors raised inside a procedure and errors raised in middleware are both logged exactly once.

### Drizzle ORM

All database access goes through Drizzle's query builder. The schema lives in `packages/db/src/schema/*.ts` and is barrel-exported from `index.ts` as a namespace object (drizzle needs the whole schema for relations). Each table module defines columns, indexes, and relations.

The **repository pattern** is the access discipline: every aggregate has a `createXStore(db, …)` factory in `packages/db/src/repositories/` that returns a typed store object (`agent-store.ts`, `session-store.ts`, `message-store.ts`, `usage-store.ts`, etc.). The factory closes over `db` and the `SecretBox` (when the aggregate has encrypted columns) and exposes typed methods — `findByTokenHash`, `create`, `listByUser`, `update`, `delete`, etc.

The `Db` type is driver-agnostic (`PgDatabase<PgQueryResultHKT, typeof schema>`), satisfied by `node-postgres` (production), Neon serverless, and PGlite (tests) — so the same repository code runs against all three.

The composition root (`services.ts:186` `buildStores`) instantiates every store and hands them to `buildServices`, which bundles them into the `services.stores` bag threaded through every procedure's `Context`.

**No raw SQL**. `scripts/check-no-raw-sql.js` is a pre-commit guard (wired in `lefthook.yml:20`) that scans staged `.ts`/`.tsx` files under `packages/db/` for the `sql\`…\`` tag template — drizzle's raw-SQL escape hatch. Any match fails the commit with a message pointing at the builder APIs (`db.insert().values()`, `db.update().set().where()`, `db.select().from().where()`, `.onConflictDoUpdate()`). Comment lines are skipped; `sql.raw()` / `sql.identifier()` (no backtick) are unaffected. This keeps the DB layer fully builder-based, which is what makes it driver-portable and SQL-injection-proof by construction.

## Design Rationale

- **scrypt + AES-256-GCM, one payload format** — scrypt makes brute-forcing the key from a leaked ciphertext expensive; GCM's auth tag detects tampering and wrong-key attempts at `final()`. One payload format (`ivHex:tagHex:dataHex`) means every encrypted column is interchangeable and self-describing.
- **Memoized SecretBox per isolate** — `scryptSync` is intentionally slow; deriving once per process and reusing keeps encryption off the hot path.
- **Random IV per encryption** — the fixed salt on the key derivation is safe because the IV is fresh every time, so identical plaintexts never repeat ciphertexts.
- **oRPC typed contract** — one `AppRouter` type flows from server router → typed client → TanStack Query utils → React components. Adding a procedure or changing an input is a compile error across the monorepo, not a runtime discovery.
- **Procedure builders as the auth seam** — auth policy is a middleware chain (`publicProcedure` → `userProcedure` → `adminProcedure`), not scattered `if (!user)` checks. Every procedure declares its gate by its builder; the gate can't be forgotten.
- **Live-block re-read** — `requireActiveUser` reads the user row per request instead of trusting JWT claims, so blocking a user takes effect on their next call without a token denylist or waiting for access-token expiry.
- **Streaming paths skip the log middleware** — the logging middleware buffers the body, which is incompatible with streaming responses. An explicit allowlist (`STREAMING_PATHS`) keeps the log coverage on request/response RPC while leaving the streams untouched.
- **Driver-agnostic repository type** — one `Db` type, three drivers (node-postgres, Neon, PGlite). The same repository code runs in production, on Workers, and in tests with an in-memory PGlite.
- **No-raw-SQL as a commit gate** — keeping the DB layer builder-only is what makes it driver-portable (no dialect-specific SQL) and injection-proof. Enforcing it in pre-commit (not just review) means the constraint can't slip through on a busy day.
- **Composition root over service locator** — `buildServices` wires every dependency explicitly at boot; procedures receive them via `Context`. No globals, no `require`-time lookups, every store is mockable in tests.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| Encryption algorithm | `packages/agent/src/crypto/secret-box.ts:8` | `aes-256-gcm` | `ALGORITHM` |
| IV length | `packages/agent/src/crypto/secret-box.ts:9` | 12 bytes | `IV_LENGTH` — randomized per encryption |
| Key length | `packages/agent/src/crypto/secret-box.ts:10` | 32 bytes | `KEY_LENGTH` — scrypt output |
| scrypt salt | `packages/agent/src/crypto/secret-box.ts:11` | `better-agent.secret-box.v1` | `SALT` — fixed; safety comes from the random IV |
| Credentials secret | `CREDENTIALS_SECRET` env | required | Must be 32+ chars; fed to `scryptSync` |
| Authz cache TTL | `packages/api/src/index.ts:63` | 60_000 ms | `AUTHZ_TTL_MS` — invite-gate cache |
| oRPC error interceptor | `apps/server/src/app.ts:52` | `log.error({ error })` | Wired on RPC + OpenAPI handlers |
| Streaming path allowlist | `apps/server/src/app.ts:25` | `sessions/prompt`, `userSessions/prompt`, `/bridge/…/stream` | Skip evlog middleware |
| Heartbeat (bridge SSE) | `apps/server/src/app.ts:42` | 15_000 ms | `HEARTBEAT_MS` — keep idle proxies alive |
| CORS origin | `CORS_ORIGIN` env | required | Re-applied in `onError` so error responses stay readable |
| Raw-SQL pattern | `scripts/check-no-raw-sql.js:21` | `/\bsql\s*\`/` | Matches the `sql\`…\`` tag template |
| No-raw-SQL scope | `scripts/check-no-raw-sql.js:62` | `packages/db/` `.ts`/`.tsx` | Staged files only |
| Pre-commit jobs | `lefthook.yml:4` | 7 parallel jobs | format, lint, file-rules, no-raw-sql, eslint, package-json, tailwind |
| Pre-push gate | `lefthook.yml:72` | `pnpm check-types` | Full-monorepo typecheck before push |
| Commit message pattern | `lefthook.yml:44` | Conventional Commits | `type(scope): description`, ≤72 chars |

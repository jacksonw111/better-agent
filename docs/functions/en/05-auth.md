# Auth & Access Control

better-agent's auth spans two SPAs (`apps/web` for customers, `apps/admin` for staff), four procedure gates (`publicProcedure`, `userProcedure`, `adminProcedure`, `agentProcedure`, `bridgeProcedure`), and three sign-in paths (password, magic link, Google OAuth). Access tokens live in memory only; refresh tokens persist in `localStorage`. An invite gate further restricts web customers unless they redeem a code. The same oRPC link interceptor — 401 → refresh → retry → redirect to `/login` — runs in both apps.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (apps/web or apps/admin)                             │
│    auth.ts: accessToken (in-memory) + refreshToken (localStorage) │
│    orpc.ts: RPCLink → header(Bearer) → interceptor(401→refresh→retry) │
│    auth-guard.tsx: AuthBoundary                                │
│      useAuthBootstrap: refresh→setTokens on load               │
│      PUBLIC_PATHS skip; else redirect to /login                │
│      web: invite.status gate → /invite redirect                │
│      admin: me.isAdmin gate → NotAuthorizedScreen              │
└──────────────────────┬───────────────────────────────────────┘
                       │  Bearer JWT (access) / rt_ (refresh)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  oRPC server (packages/api)                                    │
│    Context resolves: authedUser (JWT), authedAgent,            │
│      authedBridgeToken (bt_ hash lookup)                       │
│    Procedure gates:                                            │
│      publicProcedure  — open (auth/refresh/invite)             │
│      userProcedure    — requireActiveUser (blocks suspended)   │
│      authorizedUserProcedure — userProcedure + invite gate     │
│      adminProcedure   — user + isAdminEmail OR user.isAdmin    │
│      agentProcedure   — agent token (t_)                       │
│      bridgeProcedure  — bridge token (bt_)                     │
│    issueTokens: single choke point (password/magic/google/refresh) │
└──────────────────────────────────────────────────────────────┘
```

### Auth system: in-memory access + persisted refresh

The access token is never written to a durable store — it lives in a module-level `let accessToken` (`apps/web/src/utils/auth.ts:5`). On reload it is lost, so `useAuthBootstrap` (`auth-guard.tsx:27`) mints a fresh one from the stored refresh token before deciding whether the user is signed in. The refresh token persists in `localStorage` under `authRefreshToken` (`auth.ts:1`).

The oRPC link (`apps/web/src/utils/orpc.ts:82`) attaches `authorization: Bearer <accessToken>` on every request. Its interceptor catches `ORPCError` with code `UNAUTHORIZED`, runs `refreshAccessToken`, and retries the original call once. A dedicated `refreshLink` (`orpc.ts:43`) — a bare `RPCLink` with no interceptors — calls `auth.refresh` so the refresh request itself can't recurse into the refresh interceptor. A module-level `refreshInFlight` promise (`orpc.ts:46`) deduplicates concurrent 401s: every simultaneous request awaits the same refresh, then retries. If refresh fails, `clearTokens()` wipes state and `redirectToLogin()` hard-navigates to `/login` (the hard navigation tears down stale in-memory state). `apps/admin/src/utils/orpc.ts` mirrors this field-for-field.

### Procedure types and the context resolution

The server resolves the principal from the bearer on every request (`packages/api/src/context.ts`), so a blocked user is rejected immediately — `requireActiveUser` (`index.ts:34`) throws `FORBIDDEN` for a `blocked` user, meaning access tokens die the moment an admin blocks the account.

| Procedure | Gate | Used by |
|-----------|------|---------|
| `publicProcedure` | none | `auth.requestLink`, `auth.verify`, `auth.refresh`, `auth.loginWithPassword`, `invite.status`, `invite.redeem`, Google auth |
| `userProcedure` | `requireActiveUser` | Most web data routes, `auth.me`, `auth.logout` |
| `authorizedUserProcedure` | user + invite gate (staff bypass) | Web customer-facing data routes (not auth/invite/admin) |
| `adminProcedure` | user + `isAdminEmail` OR `user.isAdmin` | All admin router procedures |
| `agentProcedure` | agent token (`t_`) | Web agent runtime |
| `bridgeProcedure` | bridge token (`bt_`) | Local CLI relay plane |

`issueTokens` (`packages/api/src/routers/auth-tokens.ts:13`) is the single minting choke point for password, magic-link, Google, register, and refresh paths. It re-checks `user.blocked` (so a suspension between login and token issue gets nothing), signs the JWT, creates the hashed refresh token row, and logs a `login` activity event.

### Invite gate

When the authz service is enabled (`context.services.authz.enabled`), web customers must redeem an invite code before reaching app data. `isWebAuthorized` (`index.ts:68`) caches the result for 60 seconds in `webAuthzCache` to avoid re-validating on every request; staff bypass the gate entirely. `authorizedUserProcedure` (`index.ts:86`) enforces this on data routes — a blocked-by-invite user gets `FORBIDDEN: "An invite code is required to use this app"`.

The client mirrors this: `AuthBoundary` (`apps/web/src/components/auth-guard.tsx:121`) queries `invite.status` once the user is authed. If `required && !authorized`, it redirects to `/invite`. The `/invite` route (`apps/web/src/routes/invite.tsx`) renders a ticket-stub form; `invite.redeem` calls `authz.redeem`, optimistically updates the `invite.status` query cache to `authorized: true` (so the home route's gate doesn't bounce it back), and navigates to `/dashboard`. The invite gate is **off entirely** when authz isn't configured — `isWebAuthorized` returns `true`.

### Admin auth

The admin app uses the same oRPC client and `AuthBoundary` pattern, but with a stricter gate: `AuthedContent` (`apps/admin/src/components/auth-guard.tsx:103`) queries `auth.me` and renders `NotAuthorizedScreen` unless `me.data.isAdmin`. The `loginWithPassword` procedure takes an `audience: "customer" | "staff"` field (`auth.ts:191`); the admin login form always sends `"staff"`. A customer credential is rejected with `FORBIDDEN` before any token is issued. Staff status is determined by `cred.kind === "staff"` OR `isAdminEmail(cred.email, adminEmails)` — so the super-admin email is always staff regardless of DB `kind`.

`isAdminEmail` (`packages/agent/src/auth/admin.ts:4`) checks two sources: the hardcoded `SUPER_ADMIN_EMAIL` (`"jacksonwen001@gmail.com"`, `admin.ts:1`) and the configurable `ADMIN_EMAILS` allowlist (env-driven, passed as `authConfig.adminEmails`). The DB `is_admin` flag is a third path checked server-side via `stores.user.isAdmin(user.id)`.

### Google OAuth (optional)

Google sign-in is optional — if `context.services.googleOAuth` is null, both `googleAuthUrl` and `googleSignIn` throw `NOT_FOUND: "Google sign-in is not configured"`. The flow uses OAuth 2.0 authorization code with PKCS-style state:

1. `GoogleButton` (`apps/web/src/components/google-button.tsx:6`) generates `state = crypto.randomUUID()`, stores it in `sessionStorage` under `google_oauth_state`, fetches `auth.googleAuthUrl`, and redirects.
2. Google redirects back to `/auth/google/callback` with `code` and `state` query params.
3. `GoogleCallbackPage` (`apps/web/src/routes/auth.google.callback.tsx:32`) validates `state` against `sessionStorage` (rejecting if absent/mismatched), calls `auth.googleSignIn({ code })`, which exchanges the code via `googleOAuth.exchangeCode`, requires `profile.emailVerified`, find-or-creates the user, marks email verified, and issues tokens.
4. On success, `setTokens(result)`, clears the `sessionStorage` state, and navigates to `/`.

## Key Files

| File | Responsibility |
|------|----------------|
| `apps/web/src/utils/auth.ts` | Access/refresh token storage: in-memory access, `localStorage` refresh |
| `apps/web/src/utils/orpc.ts` | RPCLink with 401→refresh→retry interceptor, `refreshAccessToken`, `redirectToLogin` |
| `apps/admin/src/utils/auth.ts` | Admin's copy of token storage (identical to web) |
| `apps/admin/src/utils/orpc.ts` | Admin's oRPC client (mirrors web's interceptor) |
| `apps/web/src/components/auth-guard.tsx` | `AuthBoundary`: bootstrap, public-path allowlist, invite gate, shell rendering |
| `apps/admin/src/components/auth-guard.tsx` | Admin `AuthBoundary`: `me.isAdmin` gate, `NotAuthorizedScreen` |
| `apps/web/src/routes/login.tsx` | Sign-in / create-account / magic-link / forgot-password modes |
| `apps/web/src/routes/invite.tsx` | Invite-code redemption: ticket-stub UI, optimistic cache update |
| `apps/web/src/routes/auth.google.callback.tsx` | Google OAuth callback: state validation, code exchange, token mint |
| `apps/web/src/components/google-button.tsx` | Google sign-in trigger: state generation, `sessionStorage`, redirect |
| `packages/api/src/index.ts` | Procedure types: `publicProcedure`, `userProcedure`, `adminProcedure`, `agentProcedure`, `bridgeProcedure`, `authorizedUserProcedure`, `isWebAuthorized` |
| `packages/api/src/routers/auth.ts` | `authRouter`: login/register/refresh/verify/logout/me, password reset, rate limits |
| `packages/api/src/routers/auth-tokens.ts` | `issueTokens`: single minting choke point, blocked-user recheck, activity log |
| `packages/api/src/routers/google-auth.ts` | `googleAuthUrl`, `googleSignIn` procedures |
| `packages/api/src/routers/invite.ts` | `inviteRouter`: `status` (cached), `redeem` |
| `packages/agent/src/auth/admin.ts` | `SUPER_ADMIN_EMAIL`, `isAdminEmail` (super-admin + allowlist) |

## Data Flow

### Sign-in (password)

```
LoginPage → orpc.auth.loginWithPassword({email, password, audience:"customer"})
  → enforcePasswordLimits (rate limit per IP + email)
  → findCredentialByEmail → verifyPassword (with dummy hash timing guard)
  → kind/audience check → issueTokens
  → JWT (accessTtl) + rt_ refresh token (hashed, stored, refreshTtl)
  → setTokens({accessToken, refreshToken}) → navigate("/")
```

### Page load / reload

```
AuthBoundary mounts → useAuthBootstrap
  → loadRefreshToken() from localStorage
  → if present: client.auth.refresh({refreshToken}) → setTokens(result) → ready=true
  → if absent: ready=true (stays signed out)
  → if refresh fails: stay signed out (silent)
AuthBoundary render: getAccessToken() !== null → authed
  → if !authed && !public: redirect to /login
  → web: invite.status query → if blocked: redirect to /invite
  → admin: auth.me → if !isAdmin: NotAuthorizedScreen
```

### 401 during a request (both apps)

```
RPCLink interceptor catches ORPCError(UNAUTHORIZED)
  → if no refreshInFlight: refreshAccessToken()
      → refreshClient.auth.refresh (bare link, no interceptor)
      → setTokens(result) → return true
      → on failure: clearTokens() → return false
  → await refreshInFlight (deduped across concurrent 401s)
  → if ok: retry next() (the original request, now with new Bearer)
  → if !ok: redirectToLogin() → window.location.href = "/login"
```

### Refresh token rotation and reuse detection

`auth.refresh` (`auth.ts:108`) implements rotating refresh tokens: on every refresh, the presented token is revoked and a new one is issued. If a **revoked** token is presented again (reuse), the server revokes **all** tokens for that user (`revokeAllForUser`) and throws `UNAUTHORIZED: "Refresh token reuse"` — a stolen-token response that locks down the account's sessions.

### Google OAuth

```
GoogleButton → state=UUID → sessionStorage → auth.googleAuthUrl → redirect
Google → /auth/google/callback?code=…&state=…
  → isValidState (sessionStorage compare) → auth.googleSignIn({code})
  → googleOAuth.exchangeCode → profile.emailVerified check
  → findOrCreate → markEmailVerified → issueTokens
  → setTokens → clear sessionStorage state → navigate("/")
```

## Design Rationale

- **Access token in memory only** — XSS cannot exfiltrate it from `localStorage` because it isn't there. The refresh token is, but it's single-use (rotating), so a stolen refresh token is valid for at most one exchange before reuse detection fires.
- **Hard redirect to `/login` on refresh failure** — a hard `window.location.href` navigation tears down all stale in-memory state (query caches, component state), avoiding the "half-signed-in" limbo a SPA router redirect can leave.
- **Deduplicated refresh** — `refreshInFlight` ensures that when 10 concurrent requests all get 401, only one refresh runs; the rest await and retry with the resulting token.
- **Bare refresh link** — `refreshLink` has no interceptors, so the refresh call can't recurse into the 401→refresh interceptor if the refresh itself returns 401 (which it does when the token is invalid).
- **Context resolves user from DB on every request** — `requireActiveUser` reads `context.authedUser`, which the context middleware resolves from the JWT and DB lookup per request. A blocked user is rejected immediately — there's no need to revoke outstanding JWTs; the DB check is the kill switch.
- **Staff/customer audience separation** — `loginWithPassword`'s `audience` field prevents a customer from signing into admin and vice versa, at the token-issuance layer (before any token exists). The super-admin email bypasses this to always be staff.
- **Three admin paths** — hardcoded super-admin (bootstrap), env allowlist (ops-managed), DB flag (runtime-granted). No single point of admin provisioning failure.
- **Invite gate off when unconfigured** — `isWebAuthorized` returns `true` when `authz.enabled` is false, so the gate is a no-op in deployments that don't use invite codes. Staff always bypass it.
- **Optimistic invite cache update** — `invite.redeem`'s `onSuccess` sets the `invite.status` query cache to `authorized: true` before navigating, so the home route's gate doesn't read stale cache and bounce the user back to `/invite`.
- **Google state in sessionStorage** — CSRF protection: the random `state` value proves the callback came from the Google redirect we initiated, not a forged cross-site request. `sessionStorage` (not `localStorage`) scopes it to the tab, and it's cleared after use.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| Access token TTL | `authConfig.accessTtl` | (env `ACCESS_TOKEN_TTL`) | seconds, passed to `jwtService.sign` |
| Refresh token TTL | `authConfig.refreshTtl` | (env `REFRESH_TOKEN_TTL`) | seconds, stored as `expiresAt` on the refresh row |
| Refresh token localStorage key | `apps/web/src/utils/auth.ts:1` | `authRefreshToken` | `REFRESH_KEY` constant |
| Magic link TTL | `authConfig.magicLinkTtl` | (env) | seconds; link email sent with `?token=ml_…` |
| Password reset TTL | `auth.ts:28` `RESET_TTL_MS` | 3600000 (1h) | password reset link `?token=pr_…` |
| Password min length | `auth.ts:32` `PASSWORD_MIN` | 8 | enforced in `passwordInput` zod schema |
| Super-admin email | `packages/agent/src/auth/admin.ts:1` | `jacksonwen001@gmail.com` | `SUPER_ADMIN_EMAIL`, hardcoded |
| Admin email allowlist | `authConfig.adminEmails` | (env `ADMIN_EMAILS`) | comma-separated, case-insensitive |
| Google OAuth | `context.services.googleOAuth` | null (disabled) | when configured: `authUrl`, `exchangeCode` |
| Google state storage | `google-button.tsx:8` | `sessionStorage["google_oauth_state"]` | cleared on callback success |
| Rate limits (15-min window) | `auth.ts:21-29` | link: 5/email, 20/IP; verify: 10/IP; refresh: 30/IP; password: 10/email, 20/IP; reset: 5/email, 20/IP | per `RateLimiter.hit` |
| Web authz cache TTL | `index.ts:63` `AUTHZ_TTL_MS` | 60000 (60s) | invite-gate result cached in `webAuthzCache` |
| Public paths (web) | `auth-guard.tsx:17` | `/login`, `/auth/verify`, `/auth/google/callback`, `/reset-password` | `PUBLIC_PATHS` |
| Public paths (admin) | `auth-guard.tsx:23` | `/login`, `/auth/verify` | `PUBLIC_PATHS` |
| Stale query time | `orpc.ts:17` `STALE_TIME_MS` | 60000 (60s) | TanStack Query default stale time |

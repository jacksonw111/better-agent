# Admin Back Office

The admin app (`apps/admin/`) is a TanStack Router SPA for staff users — managing customers, staff accounts, and AI provider credentials. It is a separate deployment from the customer-facing web app and sits behind a stricter auth gate: only the staff audience may sign in, and only admin-email or DB-flagged-admin accounts render the shell.

## Architecture

The admin is structured as four feature areas over a typed oRPC client, all gated by one auth boundary:

```
┌─────────────────────────────────────────────────────────────┐
│  AuthBoundary (auth-guard.tsx)                               │
│   staff-audience token → me.isAdmin → <AdminShell/>          │
│        else → NotAuthorizedScreen / redirect to /login       │
└─────────────────────────────────────────────────────────────┘
        │ TanStack Router routes (file-based)
        ├── /customers          CustomersTable (list/search/page)
        ├── /customers/$userId  CustomerInfoCard + Usage + Activity
        ├── /users              UsersTable (staff CRUD)
        ├── /providers          Tabs: Credentials / Catalog / Models
        └── /login              password sign-in (audience: "staff")
                │
                ▼  createTanstackQueryUtils(client)
        ┌──────────────────────────────────────────────────────┐
        │  orpc.* — typed RPC over /rpc (Bearer access token)  │
        └──────────────────────────────────────────────────────┘
                │  adminProcedure (packages/api/src/index.ts)
                ▼
        adminRouter { listCustomers, getCustomer, blockUser,
                       unblockUser, listStaff, createStaff,
                       deleteStaff, … } + providersRouter
```

### Two auth audiences

The platform keeps customers and staff in separate populations. `loginWithPassword` (`packages/api/src/routers/auth.ts:191`) takes an `audience` of `"customer" | "staff"`. The admin login form always sends `audience: "staff"` (`apps/admin/src/routes/login.tsx:61`); a customer credential is rejected with FORBIDDEN before any token is issued. The super-admin email (`packages/agent/src/auth/admin.ts:1` `SUPER_ADMIN_EMAIL`) is always treated as staff regardless of DB `kind`.

### The admin procedure gate

Every admin router procedure runs through `adminProcedure` (`packages/api/src/index.ts:52`):

1. `requireActiveUser(context)` — resolve the JWT bearer to a `User`, rejecting if absent or `blocked`.
2. `isAdminEmail(user.email, authConfig.adminEmails)` — the built-in super-admin OR an entry in the `ADMIN_EMAILS` allowlist.
3. OR `stores.user.isAdmin(user.id)` — a DB `is_admin` flag set out-of-band.
4. If neither, throw `FORBIDDEN`.

The client re-checks on boot: `useAuthBootstrap` mints a fresh access token from the stored refresh token, then `AuthBoundary` reads `me.isAdmin` before rendering `<AdminShell/>`. A non-admin who somehow obtained a staff token sees `NotAuthorizedScreen` and is offered sign-out (`apps/admin/src/components/auth-guard.tsx:82`).

## Key Files

| File | Responsibility |
|------|----------------|
| `apps/admin/src/routes/customers.index.tsx` | Customer list: `listCustomers` query + `useListView` (search/paginate) |
| `apps/admin/src/routes/customers.$userId.tsx` | Customer detail: info card + usage section + activity timeline; NOT_FOUND redirect |
| `apps/admin/src/routes/users.tsx` | Staff list: `listStaff`, client-side search + `PAGE_SIZE=10` pagination, delete via `deleteStaff` |
| `apps/admin/src/routes/providers.tsx` | Three-tab providers page (Credentials / Catalog / Models) |
| `apps/admin/src/routes/login.tsx` | Password sign-in, hardcoded `audience: "staff"` |
| `apps/admin/src/components/auth-guard.tsx` | `AuthBoundary`: refresh bootstrap, public-path allowlist, `me.isAdmin` gate, redirect to `/login` |
| `apps/admin/src/components/customers/customers-table.tsx` | Avatar + email + verified/joined/status + chevron link to detail |
| `apps/admin/src/components/customers/customer-info-card.tsx` | Detail header: avatar, status badge, joined/verified/agentCount, `BlockToggle` |
| `apps/admin/src/components/customers/block-toggle.tsx` | Confirm-popover `Block` / outline `Unblock`; invalidates customer+list+activity queries |
| `apps/admin/src/components/customers/customer-usage-section.tsx` | `SummaryCards` + `TokenChart` + `WindowToggle` (window-day selector) |
| `apps/admin/src/components/customers/activity-timeline.tsx` | `customerActivity` query, icon-mapped event timeline |
| `apps/admin/src/components/users/users-table.tsx` | Staff rows; self-row shows "you" (no delete); others get `DeleteConfirm` |
| `apps/admin/src/components/users/add-staff-dialog.tsx` | Email + password (min 8) dialog calling `createStaff` |
| `apps/admin/src/components/providers/credentials-card.tsx` | Credential CRUD table; add/edit via `CredentialDialog`, delete via confirm popover |
| `apps/admin/src/components/providers/catalog-card.tsx` | Catalog list + `Refresh catalog` mutation calling `catalogRefresh` |
| `apps/admin/src/components/providers/models-card.tsx` | Provider select → `modelsList` table (model, name, context, tools) |
| `packages/api/src/routers/admin-customers.ts` | `listCustomers`, `getCustomer`, `customerUsage`, `customerActivity`, `blockUser`, `unblockUser` |
| `packages/api/src/routers/admin.ts` | Merges `adminCustomersRouter`; adds `listStaff`, `createStaff`, `deleteStaff` (self/super-admin guards) |
| `packages/api/src/routers/providers.ts` | `catalogList`, `catalogRefresh`, `credentialsList/Upsert/Delete`, `modelsList` (admin); `available`/`models` (any user) |
| `packages/api/src/index.ts` | `adminProcedure` (audience + allowlist + isAdmin), `requireActiveUser` (blocks blocked users live) |
| `packages/agent/src/auth/admin.ts` | `SUPER_ADMIN_EMAIL` constant, `isAdminEmail(email, allowlist)` |

## Data Flow

### Customer list → detail

`customers.index.tsx:21` runs `orpc.admin.listCustomers.queryOptions()`, which resolves every user of `kind === "customer"` (`admin-customers.ts:24`). The `useListView` hook layers client-side email-substring filter + pagination over the result. Clicking a row navigates to `/customers/$userId`, where `customers.$userId.tsx:55` issues three independent queries:

- `getCustomer` — info + `agentCount` (a separate `listByUser` count),
- `customerUsage` (via `useCustomerUsage`) — daily token series for the chart,
- `customerActivity` — recent events for the timeline.

A NOT_FOUND (deleted between list and detail) is detected by `isNotFound` (`customers.$userId.tsx:18`) and redirected back to `/customers` with a toast.

### Block / Unblock

`block-toggle.tsx:26` calls `blockUser`. Server-side (`admin-customers.ts:58`) this does three things in order:

1. `requireCustomer` — confirm the id is a real customer (NOT_FOUND otherwise).
2. `stores.user.setBlocked(userId, true)` — flips the `blocked` flag.
3. `stores.refreshToken.revokeAllForUser(userId)` — **every** refresh token is revoked, so the user's existing sessions cannot mint a new access token.

Because `requireActiveUser` (`packages/api/src/index.ts:34`) re-reads the user row on **every** authed request and throws FORBIDDEN when `blocked` is true, even already-issued access tokens stop working immediately (they live at most the access-token TTL, but the next request fails at the gate). An `account_blocked` activity row is logged. `unblockUser` clears the flag and logs `account_unblocked`; no token re-issuance — the user must sign in again.

The client invalidates three query keys on success (`block-toggle.tsx:17`): the detail's `getCustomer`, the list `listCustomers`, and `customerActivity` (so the timeline picks up the new event).

### Staff create / delete

`createStaff` (`admin.ts:16`) is the only path that creates a `kind: "staff"` row — web sign-up (`registerWithPassword`) hard-codes `kind: "customer"` (`auth.ts:182`). Email uniqueness is enforced server-side (CONFLICT on existing email). Password is scrypt-hashed via `hashPassword` before storage.

`deleteStaff` (`admin.ts:34`) refuses two cases before touching the DB:

- `input.userId === context.authedUser.id` → BAD_REQUEST "You cannot delete your own account" — also enforced UI-side in `users-table.tsx:36` (the self-row renders "you" instead of a delete button).
- `target.email === SUPER_ADMIN_EMAIL` → BAD_REQUEST "The super admin cannot be deleted" — the super-admin is irrevocable.

A valid deletion revokes all the target's refresh tokens first, then hard-deletes the row.

### Provider credentials & catalog

The providers page is three tabs sharing one `catalogList` query (the source of provider ids/names):

- **Credentials** (`credentials-card.tsx`) — `credentialsList` returns masked rows (`providerId`, `last4`, `baseURL`, `enabled`). Add/Edit opens `CredentialDialog` → `credentialsUpsert` (`providers.ts:24`) which encrypts the raw key with `SecretBox` before it ever reaches the DB (see [13-cross-cutting.md]). Delete goes through a confirm popover → `credentialsDelete`.
- **Catalog** (`catalog-card.tsx`) — `catalogList` shows the known provider directory; `Refresh catalog` calls `catalogRefresh` → `services.catalog.sync()`, which pulls from models.dev and upserts the catalog + model cache.
- **Models** (`models-card.tsx`) — pick a provider, then `modelsList` returns its cached models (id, name, contextLimit, toolCall capability) for inspection.

`available` and `models` (`providers.ts:46`) are the web-safe, non-admin counterparts: any authorized user may read the enabled provider ids and a provider's models (no secrets) — these back the agent-creation flow in the web app.

## Design Rationale

- **Separate audience enum, not a role flag on one user table** — keeping `kind: "customer" | "staff"` in the credential row means a customer can never sign in to the admin even if their token leaks into the admin's origin; the gate is at issuance, not just at the procedure.
- **Live blocked check on every request** — `requireActiveUser` reads the row fresh per request rather than trusting the JWT's claims. Blocking takes effect on the very next API call, without waiting for the access token to expire.
- **Block revokes refresh tokens, not access tokens** — there is no access-token denylist; instead every refresh token is killed so no new access token can be minted, and the live row-check makes the current one useless within one request. Simple, stateless, and immediate.
- **Self/super-admin delete guards in the procedure, not just the UI** — the UI hides the button, but the server enforces it independently so a crafted request can't bypass it.
- **`createStaff` is the only staff-creation path** — sign-up is hard-pinned to customers; staff must be provisioned by an existing admin, matching the operational model.
- **Credentials stored encrypted, listed masked** — the list never returns the raw key (only `last4`); the raw key is sealed with `SecretBox` and only decrypted inside the runtime when calling the provider.
- **Client-side search/pagination over full lists** — customer/staff volumes are small enough that fetching all rows and slicing in `useListView` is simpler than server-side pagination, and keeps the typed query cache trivially invalidatable.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| Staff sign-in audience | `apps/admin/src/routes/login.tsx:61` | `"staff"` | Hardcoded; cannot be changed from the UI |
| Password minimum length | `apps/admin/src/routes/login.tsx:12` | 8 | `PASSWORD_MIN`, mirrored server-side (`auth.ts:32`) |
| Staff page size | `apps/admin/src/routes/users.tsx:16` | 10 | `PAGE_SIZE`, client-side slice |
| Query stale time | `apps/admin/src/utils/orpc.ts:18` | 60_000 ms | `STALE_TIME_MS` on the QueryClient |
| Super-admin email | `packages/agent/src/auth/admin.ts:1` | `jacksonw111@gmail.com` | Compile-time constant; irrevocable |
| Admin email allowlist | `ADMIN_EMAILS` env var | empty | Comma-separated; checked by `isAdminEmail` |
| DB admin flag | `users.is_admin` column | false | Out-of-band escalation path; checked by `stores.user.isAdmin` |
| Public paths (no auth) | `apps/admin/src/components/auth-guard.tsx:23` | `/login`, `/auth/verify` | `PUBLIC_PATHS`, bypass the redirect |
| Access-token redirect on expiry | `apps/admin/src/utils/orpc.ts` | `/login` | Hard navigation on refresh failure, tears down stale state |

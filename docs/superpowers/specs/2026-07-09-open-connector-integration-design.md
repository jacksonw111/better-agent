# OpenConnector Integration — Design Spec

**Date:** 2026-07-09
**Status:** Approved (integration depth = mirror Composio; deploy = independent GH Action)

## Goal

Integrate [oomol-lab/open-connector](https://github.com/oomol-lab/open-connector) — an
open-source, self-hostable auth gateway to 1000+ SaaS providers / 9400+ actions — into
better-agent, so agents can call third-party provider actions. The integration mirrors the
existing **Composio** vertical slice end-to-end, and open-connector is deployed to a Cloudflare
Worker via an independent GitHub Action.

## Why mirror Composio

Composio and open-connector solve the same problem (credentialed provider actions for agents).
The Composio slice already exists across `packages/db` → `packages/agent` → `apps/server` →
`packages/api` → `apps/web`. Cloning that proven structure minimizes risk and keeps the two
integrations symmetric in the UI (a second tab under Integrations).

## What open-connector is (research summary)

- Hono + `@modelcontextprotocol/sdk`, TypeScript, Apache-2.0.
- **Cloudflare Workers first-class:** `wrangler.example.jsonc` binds **D1** (connections, OAuth
  config/state, runtime tokens, run logs), **R2** (transit files), **Static Assets** (Web Console).
  `npm run deploy:cloudflare` generates catalog → builds console → `wrangler deploy`.
- **Auth (path-prefix scoped):** `/api/*` (+ docs, `/oauth/*`) require `OOMOL_CONNECT_ADMIN_TOKEN`;
  `/v1/*` and `/mcp` require `OOMOL_CONNECT_RUNTIME_TOKEN` (or a stored `oct_…` token). Both sent
  as `Authorization: Bearer <token>`. Unset token ⇒ that scope is open.
- **`/api/*` returns raw JSON; `/v1/*` wraps in `{success,message,data,meta}`.** Error shapes differ
  (`{error:{code,message}}` for `/api`, failure envelope for `/v1`). The client handles both.

## Account model

An **OpenConnector account** (our row) = a pointer to one open-connector instance:

| field | purpose |
|---|---|
| `name` | display label |
| `baseUrl` | instance origin, e.g. `https://open-connector.<acct>.workers.dev` |
| `adminTokenCipher` / `adminTokenLast4` | gates `/api/*` (connections, OAuth config) |
| `runtimeTokenCipher` / `runtimeTokenLast4` | gates `/v1/*` + `/mcp` (list actions, execute) |
| `userId` | owner (nullable, mirrors composio) |

Unlike Composio (one API key, multi-tenant `userId` scope), an open-connector instance is
**single-tenant**: connections are global to the instance. Each account therefore represents one
instance's credential space. (Per-user isolation via connection aliases is a future enhancement.)

## Tool assembly (the crux — Composio-faithful)

Mirror `assembleAgentToolDefs` / `safeComposioDefs`:

1. `listConnections()` → `GET /api/connections` (admin token). Keep connections where
   `configured === true && virtual === false` (explicitly set-up providers; virtual = untouched
   no-auth providers, excluded to avoid flooding).
2. For each such service: `GET /v1/actions?service=<svc>` (runtime token) → actions. Cap at
   `ACTIONS_PER_SERVICE = 30` (parallels Composio's `TOOLS_PER_TOOLKIT`).
3. Map each action → `ToolDef`: `name = action.id` (`<service>.<name>`),
   `description = action.description`, `parameters = action.inputSchema` (a JSON Schema),
   `execute(args) => POST /v1/actions/<id>  {input: args}` (runtime token) → unwrap
   `{success,data}` envelope.
4. `shapeSourceDefs` applies the existing allowlist + `defer:true` machinery, so bulky tools hide
   behind `search_tools` exactly like Composio. Errors degrade to `[]` (never break a turn).

## Service interface

`OpenConnectorService` (mirrors `ComposioService`), a thin `fetch` wrapper:

```ts
listProviders(): Promise<OpenConnectorProviderMeta[]>          // GET /v1/providers (runtime) — catalog for the tab
listConnections(): Promise<OpenConnectorConnectionMeta[]>      // GET /api/connections (admin)
connectWithKey(input: { service; authType; values }): Promise<{ configured: boolean }>  // PUT /api/connections/:service (admin)
disconnect(service: string): Promise<void>                     // DELETE /api/connections/:service (admin)
listActions(services: string[]): Promise<OpenConnectorActionMeta[]>  // per service GET /v1/actions?service= (runtime)
execute(input: { actionId; args }): Promise<ExecuteResult>     // POST /v1/actions/:id (runtime)
```

- `OpenConnectorProviderMeta`: `{ service, displayName, iconUrl, categories, authTypes, needsAuth }`
  (needsAuth = `!authTypes.includes("no_auth")`).
- `OpenConnectorConnectionMeta`: `{ id, service, connectionName, authType, configured, virtual }`.
- `OpenConnectorActionMeta`: `{ id, service, name, description, inputSchema }`.
- `connectWithKey` body: `{ authType: "api_key"|"custom_credential"|"no_auth", values: {...} }`
  (api_key ⇒ `values.apiKey`; custom_credential ⇒ provider field keys).

### Auth-scheme mapping for the connect UI

open-connector `authTypes`: `no_auth | api_key | custom_credential | oauth2` (there is **no**
`bearer`; bearer-style auth is modeled as `custom_credential`). The connect dialog offers:
- `api_key` present → single API-key field.
- `custom_credential` present → render the provider's credential fields (future: fetch field defs
  from `GET /api/providers/:service`); v1 ships a generic JSON/key-value entry.
- `oauth2` → **Phase 2** (needs per-provider client id/secret via `PUT /api/oauth/configs/:service`
  then `POST /api/oauth/authorizations` → `authorizationUrl`, same popup as Composio's OAuth).

## Deployment (independent GH Action)

New workflow `.github/workflows/deploy-open-connector.yml`, `workflow_dispatch` (+ optional cron/dev
trigger). It does NOT vendor open-connector into our pnpm monorepo (npm/oxlint toolchain, postinstall
codegen). Steps:

1. `actions/checkout` **oomol-lab/open-connector** at a pinned commit SHA (`repository:` +
   `ref:`), Node 24, `npm ci`.
2. Materialize `wrangler.local.jsonc` from `wrangler.example.jsonc`, injecting the D1 `database_id`
   from repo secret/var `OC_D1_DATABASE_ID` (created once via `wrangler d1 create open-connector`;
   R2 bucket `open-connector-transit-files` created once).
3. `npx wrangler d1 migrations apply open-connector --remote --config wrangler.local.jsonc`.
4. Set secrets idempotently: `OOMOL_CONNECT_ADMIN_TOKEN`, `OOMOL_CONNECT_RUNTIME_TOKEN`,
   `OOMOL_CONNECT_ENCRYPTION_KEY` (via `wrangler secret put`, piped from GH secrets — never echoed).
5. `npm run deploy:cloudflare`.

Env: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (already present). One-time bootstrap
(D1/R2 create + capture database_id) documented in the plan; secrets generated and stored via
`gh secret set` without materializing into any transcript.

The deployed instance's `baseUrl` + `runtimeToken` + `adminToken` are then entered once in the
web Integrations → OpenConnector tab to create the account.

## Files (mirror of the Composio slice)

1. `packages/db/src/schema/openconnector.ts` — `openConnectorAccounts` table; barrel in
   `schema/index.ts`; add `openConnectorAccountIds` jsonb to `agents`.
2. `packages/agent/src/ports.ts` — `OpenConnectorAccountRow` + `OpenConnectorAccountStore`;
   `AgentStore.unlinkOpenConnectorAccount`.
3. `packages/db/src/repositories/openconnector-account-store.ts` (+ integration test); extend
   `unlinkFromColumn` union + `toAgentConfig` in `agent-store.ts`.
4. `packages/agent/src/tool/openconnector-tools.ts` — `OpenConnectorService` interface,
   metadata types, `buildOpenConnectorToolDefs`.
5. `apps/server/src/openconnector.ts` — `createOpenConnectorService({ baseUrl, adminToken,
   runtimeToken })` (fetch client) + mappers + test.
6. `apps/server/src/optional-services.ts` — `buildOpenConnectorAccountResolver`.
7. `apps/server/src/services.ts` — wire store + resolver (`openConnector`).
8. `packages/api/src/services.ts` — `openConnector` resolver + `stores.openConnectorAccount`.
9. `packages/api/src/routers/openconnector.ts` (mirror procedures + owner guards + error mapper);
   mount in `routers/index.ts`.
10. `packages/api/src/routers/agent-tool-defs.ts` — `safeOpenConnectorDefs` + wire
    `openConnectorAccountIds`; `agents.ts` `agentInput` + `filterOwnedLinks`.
11. `apps/web/src/components/integrations/` — account list/detail/connect components with
    `orpc.openConnector.*`; derived types in `api-types.ts`; add `"openconnector"` tab.
12. `apps/web/src/components/agents/openconnector-accounts-field.tsx`.
13. `.github/workflows/deploy-open-connector.yml` + one-time bootstrap doc.
14. DB migration (`pnpm --filter @better-agent/db db:generate`).

No admin-app work (Composio is web-only now).

## Non-goals (v1)

- OAuth2 connect flow (Phase 2 — needs per-provider client credentials).
- Per-user connection isolation via aliases.
- Vendoring open-connector into the monorepo.
- Transit-file uploads / proxy endpoints.

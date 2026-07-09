# OpenConnector Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "OpenConnector" integration that mirrors the existing Composio vertical slice
end-to-end, letting agents call provider actions from a self-hosted open-connector instance, and
deploy open-connector to a Cloudflare Worker via an independent GitHub Action.

**Architecture:** Clone the Composio slice (`packages/db` → `packages/agent` → `apps/server` →
`packages/api` → `apps/web`). An OpenConnector "account" points at one open-connector instance
(`baseUrl` + admin token + runtime token). Tools are built Composio-faithfully: per configured
connection, list that provider's actions and map each to a `ToolDef`.

**Tech Stack:** TypeScript, Drizzle (Postgres), oRPC, React + TanStack Router, Cloudflare
Workers (open-connector deploy). Package manager: pnpm. Lint: Biome (ultracite) + ESLint.

## Global Constraints

- Mirror the Composio files named in each task; read them as the structural source of truth. Keep
  naming symmetric: `openConnector` (camel), `open_connector_accounts` (table),
  `openConnectorAccountIds` (agents column), router key `openConnector`, web tab `"openconnector"`.
- Biome/ultracite clean + ESLint clean (complexity 10, max-lines-per-function 50, file-line cap
  299, `describe` ≤ 50 lines). Run `pnpm dlx ultracite check <files>` before committing.
- Stage ONLY your changed files (a concurrent session shares this tree). Never `git add -A`. Verify
  `git status --short` and `git diff --stat HEAD` before staging.
- DB is shared/local: use `pnpm --filter @better-agent/db db:generate` to create migrations
  (drizzle-kit), never `db:push`.
- Secrets stored via SecretBox (`box.encrypt`/`box.decrypt`); never return plaintext tokens to
  clients; expose only `…Last4`.
- Run the relevant package test suite for each task (`pnpm -F <pkg> test`) and `check-types`.

## open-connector API reference (embedded — no clone needed)

Base auth: `Authorization: Bearer <token>`. `/api/*` uses the **admin** token and returns **raw
JSON**. `/v1/*` + `/mcp` use the **runtime** token and wrap responses in
`{ success, message, data, meta }` (failure: `{ success:false, message, data, errorCode, meta }`).
`/api/*` errors are `{ error: { code, message } }`.

- `GET /v1/providers` (runtime) → `data: [{ service, displayName, iconUrl, homepageUrl,
  categories:[{id,displayName}], authTypes:string[] }]`. `authTypes ∈ {no_auth, api_key,
  custom_credential, oauth2}` (no `bearer`). needsAuth = `!authTypes.includes("no_auth")`.
- `GET /api/connections` (admin) → raw `[{ id:"<service>:<name>", service, connectionName,
  authType, configured:boolean, virtual:boolean, default:boolean, profile:{...} }]`.
- `PUT /api/connections/:service` (admin) body `{ authType:"api_key"|"custom_credential"|"no_auth",
  values:{...}, connectionName? }` (api_key ⇒ `values.apiKey`) → returns the `ConnectionSummary`.
- `DELETE /api/connections/:service` (admin) → reset summary.
- `GET /v1/actions?service=<svc>` (runtime) → `data:[{ id:"<svc>.<name>", service, name,
  description, requiredScopes, providerPermissions, inputSchema:JsonSchema, outputSchema, ... }]`.
  Without `?service=` → `data:[{ service }]` (distinct services only).
- `POST /v1/actions/:actionId` (runtime) body `{ input:{...} }` → success
  `{ success:true, data:<output|null>, meta:{executionId,actionId} }`; failure
  `{ success:false, message, data, errorCode, meta }`.
- (Phase 2 OAuth) `PUT /api/oauth/configs/:service` `{clientId,clientSecret,extra?,secretExtra?}`;
  `POST /api/oauth/authorizations` `{service,connectionName?}` → `{ authorizationUrl, state }`.

---

### Task 1: DB schema + migration

**Files:**
- Create: `packages/db/src/schema/openconnector.ts`
- Modify: `packages/db/src/schema/index.ts` (add `export * from "./openconnector";`)
- Modify: `packages/db/src/schema/agents.ts` (add `openConnectorAccountIds` column)
- Migration: generated under `packages/db/src/migrations/`

**Interfaces:**
- Produces: table `openConnectorAccounts` and `agents.openConnectorAccountIds: string[]`.

Mirror `packages/db/src/schema/composio.ts`. The `openConnectorAccounts` pgTable
(`"open_connector_accounts"`) columns:
- `id` uuid PK `defaultRandom()`
- `name` text notNull
- `userId` uuid → `users.id` (nullable), with index `open_connector_accounts_user_id_idx`
- `baseUrl` text notNull
- `adminTokenCipher` text notNull, `adminTokenLast4` text notNull
- `runtimeTokenCipher` text notNull, `runtimeTokenLast4` text notNull
- `createdAt` / `updatedAt` timestamptz notNull defaultNow

In `agents.ts`, next to `composioAccountIds`, add:
`openConnectorAccountIds: jsonb("open_connector_account_ids").$type<string[]>().notNull().default([])`.

- [ ] **Step 1:** Write `schema/openconnector.ts` mirroring `schema/composio.ts` with the columns
  above. Add the barrel export and the agents column.
- [ ] **Step 2:** Generate the migration: `pnpm --filter @better-agent/db db:generate`. Confirm a
  new `NNNN_*.sql` + snapshot appear adding `open_connector_accounts` and the agents column.
- [ ] **Step 3:** `pnpm -F @better-agent/db check-types`. Commit (schema + migration files only).

---

### Task 2: Ports + tool-def builder (the interface layer)

**Files:**
- Modify: `packages/agent/src/ports.ts` (add `OpenConnectorAccountRow`, `OpenConnectorAccountStore`;
  add `unlinkOpenConnectorAccount` to `AgentStore`)
- Create: `packages/agent/src/tool/openconnector-tools.ts`

**Interfaces:**
- Consumes: `ToolDef`, `JsonSchema`, `ExecuteResult` from `./types`.
- Produces: `OpenConnectorService`, metadata types, `buildOpenConnectorToolDefs`,
  `OpenConnectorAccountStore`, `OpenConnectorAccountRow`.

In `ports.ts`, mirror the Composio block (lines ~177-198):
```ts
export interface OpenConnectorAccountRow {
  id: string; name: string; userId: string | null;
  baseUrl: string; adminTokenLast4: string; runtimeTokenLast4: string;
  createdAt: Date;
}
export interface OpenConnectorAccountStore {
  create(input: { name: string; baseUrl: string; adminToken: string; runtimeToken: string; userId?: string }): Promise<OpenConnectorAccountRow>;
  delete(id: string): Promise<void>;
  getSecrets(id: string): Promise<{ baseUrl: string; adminToken: string; runtimeToken: string } | null>;
  getById(id: string): Promise<OpenConnectorAccountRow | null>;
  list(): Promise<OpenConnectorAccountRow[]>;
  listByUser(userId: string): Promise<OpenConnectorAccountRow[]>;
}
```
Add to `AgentStore`: `unlinkOpenConnectorAccount(userId: string, accountId: string): Promise<void>;`

`tool/openconnector-tools.ts` (mirror `tool/composio-tools.ts`):
```ts
export interface OpenConnectorProviderMeta { service: string; displayName: string; iconUrl: string | null; categories: string[]; authTypes: string[]; needsAuth: boolean; }
export interface OpenConnectorConnectionMeta { id: string; service: string; connectionName: string; authType: string; configured: boolean; virtual: boolean; }
export interface OpenConnectorActionMeta { id: string; service: string; name: string; description: string; inputSchema: JsonSchema; }
export interface OpenConnectorService {
  listProviders(): Promise<OpenConnectorProviderMeta[]>;
  listConnections(): Promise<OpenConnectorConnectionMeta[]>;
  connectWithKey(input: { service: string; authType: string; values: Record<string, unknown> }): Promise<{ configured: boolean }>;
  disconnect(service: string): Promise<void>;
  listActions(services: string[]): Promise<OpenConnectorActionMeta[]>;
  execute(input: { actionId: string; args: unknown }): Promise<ExecuteResult>;
}
export async function buildOpenConnectorToolDefs(service: OpenConnectorService, services: string[]): Promise<ToolDef[]> {
  const metas = await service.listActions(services);
  return metas.map((meta) => ({
    name: meta.id, description: meta.description, parameters: meta.inputSchema,
    execute: (args) => service.execute({ actionId: meta.id, args }),
  }));
}
```

- [ ] **Step 1:** Add the ports interfaces + AgentStore method.
- [ ] **Step 2:** Write `openconnector-tools.ts`.
- [ ] **Step 3:** `pnpm -F @better-agent/agent check-types` + ultracite. Commit.

---

### Task 3: Account store + agent-store cascade

**Files:**
- Create: `packages/db/src/repositories/openconnector-account-store.ts`
- Create: `packages/db/src/repositories/openconnector-account-store.integration.test.ts`
- Modify: `packages/db/src/repositories/agent-store.ts` (extend `unlinkFromColumn` column union;
  add `unlinkOpenConnectorAccount`; add `openConnectorAccountIds` to `toAgentConfig`)

**Interfaces:**
- Consumes: `OpenConnectorAccountStore`, `OpenConnectorAccountRow` (Task 2); `Db`, `SecretBox`.
- Produces: `createOpenConnectorAccountStore(db, box)`.

Mirror `repositories/composio-account-store.ts`. `create` encrypts BOTH tokens
(`adminTokenCipher = box.encrypt(adminToken)`, `runtimeTokenCipher = box.encrypt(runtimeToken)`),
stores `adminTokenLast4 = adminToken.slice(-4)`, `runtimeTokenLast4 = runtimeToken.slice(-4)`,
`baseUrl` verbatim. `getSecrets(id)` returns `{ baseUrl, adminToken: box.decrypt(cipher),
runtimeToken: box.decrypt(cipher) }` or null. `toRow` drops ciphers.

In `agent-store.ts`:
- `unlinkFromColumn` column param union → add `"openConnectorAccountIds"`.
- Add `unlinkOpenConnectorAccount(userId, accountId)` delegating to `unlinkFromColumn(...,
  "openConnectorAccountIds", ...)`.
- `toAgentConfig`: add `openConnectorAccountIds: row.openConnectorAccountIds ?? []`.

- [ ] **Step 1:** Write the integration test mirroring
  `composio-account-store.integration.test.ts`: (a) `listByUser` returns only owner's rows +
  correct `adminTokenLast4`/`runtimeTokenLast4`; (b) `getSecrets` round-trips both tokens + baseUrl.
- [ ] **Step 2:** Run it, watch it fail.
- [ ] **Step 3:** Write the store + agent-store changes.
- [ ] **Step 4:** `pnpm -F @better-agent/db test` (all pass) + check-types. Commit.

---

### Task 4: OpenConnector service (fetch client)

**Files:**
- Create: `apps/server/src/openconnector.ts`
- Create: `apps/server/src/openconnector.test.ts`

**Interfaces:**
- Consumes: `OpenConnectorService` + metadata types (Task 2).
- Produces: `createOpenConnectorService(config: { baseUrl: string; adminToken: string;
  runtimeToken: string }): OpenConnectorService`, plus exported mappers for unit tests.

A thin `fetch` client (no SDK). Helpers:
- `adminGet/adminPut/adminDelete(path, body?)` → `Authorization: Bearer <adminToken>`, parse raw
  JSON, throw on `{error:{code,message}}` or non-2xx with the code/message.
- `runtimeGet/runtimePost(path, body?)` → `Authorization: Bearer <runtimeToken>`, unwrap
  `{success,message,data,errorCode}`; on `success:false` throw an Error carrying `errorCode` +
  `message`.
- `baseUrl` is trimmed of a trailing `/`; build URLs as `${baseUrl}${path}`.

Method mapping (exported pure mappers `mapProvider`, `mapConnection`, `mapAction`,
`mapExecuteResult` for unit tests):
- `listProviders()` → `runtimeGet("/v1/providers")` → `data.map(mapProvider)` (categories →
  `c.categories.map(x=>x.displayName)`; needsAuth = `!authTypes.includes("no_auth")`).
- `listConnections()` → `adminGet("/api/connections")` (raw array) → `map(mapConnection)`.
- `connectWithKey({service,authType,values})` → `adminPut(\`/api/connections/${service}\`,
  {authType, values})` → `{ configured: !!summary.configured }`.
- `disconnect(service)` → `adminDelete(\`/api/connections/${service}\`)`.
- `listActions(services)` → for each service `runtimeGet(\`/v1/actions?service=${enc(service)}\`)`,
  flat-map `data.map(mapAction)`, cap `ACTIONS_PER_SERVICE = 30` per service. Short-circuit `[]`
  when `services` is empty. Run services in parallel (`Promise.all`).
- `execute({actionId,args})` → `runtimePost(\`/v1/actions/${actionId}\`, { input: args })`; wrap:
  success → `{ output: JSON.stringify(data), isError: false }`; on thrown failure →
  `{ output: <message>, isError: true }`. (`mapExecuteResult` handles the success/failure shape.)
- Timeouts: wrap fetch with `AbortSignal.timeout(REQUEST_TIMEOUT_MS = 15_000)`; on action listing
  use a longer `LIST_TIMEOUT_MS = 30_000`.

- [ ] **Step 1:** Write `openconnector.test.ts` unit-testing the mappers with fixtures matching the
  API reference (a provider with `authTypes:["no_auth"]` → needsAuth false; an action
  `{id:"github.get_current_user", inputSchema:{...}}` → ToolMeta; a `/v1` success + failure
  envelope → ExecuteResult). Inject `fetchImpl` (a `fetch`-shaped fn) so no network is used.
- [ ] **Step 2:** Run tests, watch fail.
- [ ] **Step 3:** Implement `createOpenConnectorService` accepting an optional `{ fetchImpl }` for
  tests (default `globalThis.fetch`).
- [ ] **Step 4:** `pnpm -F @better-agent/server test` + check-types + ultracite. Commit.

---

### Task 5: Account resolver + services wiring

**Files:**
- Modify: `apps/server/src/optional-services.ts` (add `buildOpenConnectorAccountResolver`)
- Modify: `apps/server/src/services.ts` (store + resolver wiring)
- Modify: `packages/api/src/services.ts` (`openConnector` resolver + `stores.openConnectorAccount`)

**Interfaces:**
- Consumes: `OpenConnectorAccountStore`, `createOpenConnectorService`.
- Produces: `context.services.openConnector: (accountId) => Promise<OpenConnectorService | null>`;
  `stores.openConnectorAccount`.

Mirror `buildComposioAccountResolver`: memoize `Map<accountId, { key, service }>` keyed by
`accountId` + a hash of `getSecrets()` (e.g. `baseUrl|adminLast|runtimeLast` — or just re-fetch and
compare the full secret string). On `getSecrets(id)` null → evict + return null; else build
`createOpenConnectorService({ baseUrl, adminToken, runtimeToken })`.

`services.ts`: add to `buildMiscStores`
`openConnectorAccount: createOpenConnectorAccountStore(db, secretBox)`; add to `StoreParts` +
`buildStores`; in `assembleServices` add
`openConnector: buildOpenConnectorAccountResolver(parts.openConnectorAccount)`.

`packages/api/src/services.ts`: add `openConnector: (accountId: string) =>
Promise<OpenConnectorService | null>;` and `stores.openConnectorAccount: OpenConnectorAccountStore;`.

- [ ] **Step 1:** Add the resolver + all wiring.
- [ ] **Step 2:** `pnpm -F @better-agent/server check-types` + `pnpm -F @better-agent/api
  check-types`. Commit.

---

### Task 6: oRPC router + agent tool assembly + agent input

**Files:**
- Create: `packages/api/src/routers/openconnector.ts`
- Modify: `packages/api/src/routers/index.ts` (mount `openConnector: openConnectorRouter`)
- Modify: `packages/api/src/routers/agent-tool-defs.ts` (`safeOpenConnectorDefs` + wire into
  `assembleAgentToolDefs`)
- Modify: `packages/api/src/routers/agents.ts` (`agentInput.openConnectorAccountIds` +
  `filterOwnedLinks`)

**Interfaces:**
- Consumes: `context.services.openConnector`, `stores.openConnectorAccount`.
- Produces: `orpc.openConnector.*` procedures.

Mirror `routers/composio.ts`. Owner guards `requireOwnedOpenConnectorAccount` /
`requireOwnedService`; error mapper `toOpenConnectorError` (map thrown `errorCode`/HTTP 401/403 →
BAD_REQUEST with a readable message). Procedures (all `authorizedUserProcedure`):

| Procedure | Input | Calls |
|---|---|---|
| `listAccounts` | — | `stores.openConnectorAccount.listByUser(userId)` |
| `createAccount` | `{ name, baseUrl, adminToken, runtimeToken }` (all min1; baseUrl a URL) | create, then validate by calling `service.listConnections()`; roll back (delete) on failure; activity log `open_connector_account_added` |
| `deleteAccount` | `{ accountId: uuid }` | `store.delete` + `agent.unlinkOpenConnectorAccount` + activity `open_connector_account_removed` → `{ok:true}` |
| `providers` | `{ accountId }` | `service.listProviders()` |
| `connections` | `{ accountId }` | `service.listConnections()` |
| `connectWithKey` | `{ accountId, service, apiKey }` (v1: api_key only) | `service.connectWithKey({ service, authType:"api_key", values:{ apiKey } })` |
| `disconnect` | `{ accountId, service: string.min1 }` | `service.disconnect(service)` → `{ok:true}` |
| `tools` | `{ accountId }` | configured connections → services → `service.listActions` → `{ services, tools:[{name,description}] }` (diagnostic) |

`agent-tool-defs.ts` — add:
```ts
export async function safeOpenConnectorDefs(service: OpenConnectorService | null): Promise<ToolDef[]> {
  if (!service) return [];
  try {
    const connections = await service.listConnections();
    const services = [...new Set(connections.filter((c) => c.configured && !c.virtual).map((c) => c.service))];
    if (services.length === 0) return [];
    return await buildOpenConnectorToolDefs(service, services);
  } catch (error) { log.error("tools", `openconnector defs failed: ${msg(error)}`); return []; }
}
```
In `assembleAgentToolDefs`, add `agent.openConnectorAccountIds` to the signature, compute
`perOc = await Promise.all((agent.openConnectorAccountIds ?? []).map(async (id) =>
safeOpenConnectorDefs(await context.services.openConnector(id))))`, and include `...perOc.flat()`
in the `shapeSourceDefs([...])` array. Every caller passing an `agent` object must include
`openConnectorAccountIds` (agents already carry it from `toAgentConfig`).

`agents.ts`: `agentInput` add `openConnectorAccountIds: z.array(z.uuid()).default([])`;
`filterOwnedLinks` drop unowned ids via `openConnectorAccount.listByUser`.

- [ ] **Step 1:** Write the router + mount + agent-tool-defs + agents.ts changes.
- [ ] **Step 2:** Add/extend a unit test for `safeOpenConnectorDefs` (fake service: connections
  with configured/virtual mix → only non-virtual configured services' actions become defs). Mirror
  any existing `agent-tool-defs` test; if none, add a focused one.
- [ ] **Step 3:** `pnpm -F @better-agent/api test` + check-types. Commit.

---

### Task 7: Web UI — Integrations tab + agent field

**Files:**
- Modify: `apps/web/src/routes/integrations.index.tsx` (add `"openconnector"` tab)
- Create: `apps/web/src/components/integrations/oc-accounts-list.tsx`
- Create: `apps/web/src/components/integrations/oc-add-account-dialog.tsx`
- Create: `apps/web/src/components/integrations/oc-account-detail.tsx`
- Create: `apps/web/src/components/integrations/oc-providers-section.tsx`
- Create: `apps/web/src/components/integrations/oc-connect-key-dialog.tsx`
- Modify: `apps/web/src/routes/integrations.$accountId.tsx` (route both composio + oc detail; or add
  `apps/web/src/routes/integrations.oc.$accountId.tsx`)
- Modify: `apps/web/src/utils/api-types.ts` (derived OC row types)
- Create: `apps/web/src/components/agents/openconnector-accounts-field.tsx`
- Modify: the agent wizard/form to render `OpenConnectorAccountsField` next to
  `ComposioAccountsField` (find the consumer of `composio-accounts-field.tsx`).

**Interfaces:**
- Consumes: `orpc.openConnector.*`.

Mirror the Composio components (`accounts-list.tsx`, `add-account-dialog.tsx`,
`account-detail.tsx`, `toolkits-section.tsx`, `connect-key-dialog.tsx`,
`composio-accounts-field.tsx`) with these deltas:
- Add dialog collects `name`, `baseUrl`, `adminToken` (password), `runtimeToken` (password).
- `oc-providers-section.tsx` merges `orpc.openConnector.providers` (catalog) with
  `orpc.openConnector.connections` (case-insensitive by `service`); connected rows show a green
  check + Disconnect (`orpc.openConnector.disconnect`), others show Connect. v1 Connect always opens
  `oc-connect-key-dialog` (single API-key field → `orpc.openConnector.connectWithKey`). Providers
  whose `authTypes` are only `oauth2` show a disabled "OAuth (coming soon)" state.
- `integrations.index.tsx`: `SettingsTab = "composio" | "openconnector" | "mcp"`;
  `TABS` add `{ id:"openconnector", label:"OpenConnector" }`; render `<OcAccountsList/>` for it.
- `api-types.ts`: `OpenConnectorAccountRow = Awaited<ReturnType<Client["openConnector"]
  ["listAccounts"]>>[number]`; `OpenConnectorProviderRow = …["providers"]…`.
- `openconnector-accounts-field.tsx`: single-select over `string[]` (0 or 1), same as
  `composio-accounts-field.tsx`, bound to `openConnectorAccountIds`.

Frontend UX bar (per project standard): consistent spacing scale, responsive, loading skeletons,
error toasts on every mutation.

- [ ] **Step 1:** api-types + integrations tab + account list/add-dialog/detail.
- [ ] **Step 2:** providers section + connect-key dialog.
- [ ] **Step 3:** agent field + wire into the agent form.
- [ ] **Step 4:** `pnpm -F web check-types` + ultracite + `pnpm -F web build`. Commit.

---

### Task 8: Deploy workflow + bootstrap doc

**Files:**
- Create: `.github/workflows/deploy-open-connector.yml`
- Create: `docs/open-connector-deploy.md`

**Interfaces:** none (infra).

Workflow (`workflow_dispatch`, pinned to open-connector `d375308e28742cadef40b09b2a202aafb7778d46`):
```yaml
name: Deploy open-connector (Workers)
on: { workflow_dispatch: {} }
concurrency: { group: deploy-open-connector, cancel-in-progress: true }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: oomol-lab/open-connector
          ref: d375308e28742cadef40b09b2a202aafb7778d46
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - name: Materialize wrangler config
        run: |
          cp wrangler.example.jsonc wrangler.local.jsonc
          # replace <your-d1-database-id> with the secret
          node -e "const fs=require('fs');const f='wrangler.local.jsonc';let s=fs.readFileSync(f,'utf8');s=s.replace('<your-d1-database-id>', process.env.OC_D1_DATABASE_ID);fs.writeFileSync(f,s)"
        env: { OC_D1_DATABASE_ID: ${{ secrets.OC_D1_DATABASE_ID }} }
      - name: Migrate D1
        run: npx wrangler d1 migrations apply open-connector --remote --config wrangler.local.jsonc
        env: { CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}, CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }} }
      - name: Set secrets
        run: |
          printf '%s' "$OC_ADMIN_TOKEN"      | npx wrangler secret put OOMOL_CONNECT_ADMIN_TOKEN      --config wrangler.local.jsonc
          printf '%s' "$OC_RUNTIME_TOKEN"    | npx wrangler secret put OOMOL_CONNECT_RUNTIME_TOKEN    --config wrangler.local.jsonc
          printf '%s' "$OC_ENCRYPTION_KEY"   | npx wrangler secret put OOMOL_CONNECT_ENCRYPTION_KEY   --config wrangler.local.jsonc
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          OC_ADMIN_TOKEN: ${{ secrets.OC_ADMIN_TOKEN }}
          OC_RUNTIME_TOKEN: ${{ secrets.OC_RUNTIME_TOKEN }}
          OC_ENCRYPTION_KEY: ${{ secrets.OC_ENCRYPTION_KEY }}
      - name: Deploy
        run: npm run deploy:cloudflare
        env: { CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}, CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }} }
```

`docs/open-connector-deploy.md` documents the one-time bootstrap:
`npx wrangler d1 create open-connector` (copy the `database_id` → repo secret `OC_D1_DATABASE_ID`),
`npx wrangler r2 bucket create open-connector-transit-files`, and the repo secrets to set
(`OC_ADMIN_TOKEN`, `OC_RUNTIME_TOKEN`, `OC_ENCRYPTION_KEY` — random 32-byte hex/base64).

- [ ] **Step 1:** Write the workflow + doc.
- [ ] **Step 2:** `actionlint` if available (or a YAML sanity check). Commit. (Actual deploy is
  triggered manually after the one-time bootstrap + secrets are set.)

---

## Self-Review notes

- Type consistency: `openConnectorAccountIds` used identically in schema (Task 1), `toAgentConfig`
  (Task 3), `agentInput`/`filterOwnedLinks` (Task 6), and the agent field (Task 7).
- `getSecrets` (not `getApiKey`) because OC needs three values; resolver + router use it.
- `execute` returns `ExecuteResult` ({output, isError}); the service stringifies `data`.
- OAuth is explicitly Phase 2; v1 Connect is API-key only. Providers that are oauth2-only render a
  disabled state, not a broken button.

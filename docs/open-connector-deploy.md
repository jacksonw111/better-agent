# Deploying open-connector to Cloudflare Workers

[open-connector](https://github.com/oomol-lab/open-connector) is the self-hosted auth gateway that
powers the **Integrations → OpenConnector** tab. It is NOT vendored into this monorepo; the
`.github/workflows/deploy-open-connector.yml` workflow checks it out at a pinned commit and runs its
own `npm run deploy:cloudflare`. This doc covers the one-time bootstrap and how to configure it in
the app afterward.

## Architecture

- **Workers** — HTTP runtime (`main: src/server/cloudflare.ts`).
- **D1** — connections, OAuth config/state, runtime tokens, run logs.
- **R2** — temporary transit files.
- **Static Assets** — the open-connector Web Console (served at the Worker root).

All within Cloudflare's free tier.

## Bootstrap

The workflow is **self-bootstrapping**: it creates the D1 database and R2 bucket on its first run
(idempotent afterwards) and resolves the D1 id at runtime, authenticating entirely through the
existing `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets. No local `wrangler login` and no
`OC_D1_DATABASE_ID` are needed.

The only prerequisite is three stable secrets (they must NOT change between runs — the encryption
key is scrypt-stretched to the AES-256 key, and the tokens are stored in the app account row):

| Secret | Purpose |
|---|---|
| `OC_ADMIN_TOKEN` | random string — gates open-connector `/api/*` |
| `OC_RUNTIME_TOKEN` | random string — gates `/v1/*` + `/mcp` |
| `OC_ENCRYPTION_KEY` | random string — scrypt→AES-256-GCM for stored provider credentials |

Set them once (piped so the value never hits shell history):

```bash
openssl rand -hex 32 | gh secret set OC_ADMIN_TOKEN    --repo jacksonw111/better-agent
openssl rand -hex 32 | gh secret set OC_RUNTIME_TOKEN  --repo jacksonw111/better-agent
openssl rand -hex 32 | gh secret set OC_ENCRYPTION_KEY --repo jacksonw111/better-agent
```

> The **CLOUDFLARE_API_TOKEN must have D1:Edit, R2:Edit, and Workers Scripts:Edit** permissions for
> the self-bootstrap (create D1/R2, put secrets, deploy). The existing token is used for the other
> Workers deploys; if the bootstrap step fails with an authorization error, widen the token's scope.

## Deploy

Trigger the workflow from the Actions tab (**Deploy open-connector (Workers)** → Run workflow), or:

```bash
gh workflow run deploy-open-connector.yml --repo jacksonw111/better-agent
```

The workflow materializes `wrangler.local.jsonc` from the example (injecting `OC_D1_DATABASE_ID`),
applies D1 migrations, sets the three Worker secrets, and deploys. The Worker URL is printed at the
end (typically `https://open-connector.<account>.workers.dev`).

## Configure in the app

Integrations → **OpenConnector** → add an account:

- **Base URL** — the deployed Worker URL.
- **Admin token** — the `OC_ADMIN_TOKEN` value (manages provider connections).
- **Runtime token** — the `OC_RUNTIME_TOKEN` value (lists + executes actions, used for the agent's
  tools).

Then open the account, connect providers with an API key, and link the account to an agent in the
agent wizard's Tools step. The agent gains each connected provider's actions as tools.

## Bumping the pinned version

Edit `OPEN_CONNECTOR_REF` in `.github/workflows/deploy-open-connector.yml` to a new open-connector
commit SHA after reviewing upstream changes, then re-run the workflow (it re-applies any new D1
migrations).

## Notes

- OAuth2 providers are not yet connectable from the app (v1 supports API-key connect). Configure
  OAuth providers directly in the open-connector Web Console at the Worker root if needed.
- The Web Console at the Worker root is gated by `OOMOL_CONNECT_ADMIN_TOKEN`.

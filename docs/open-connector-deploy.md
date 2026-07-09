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

## One-time bootstrap

Run locally with Wrangler logged in to the same Cloudflare account the app deploys to
(`npx wrangler login`). Node 22+.

```bash
# 1. Create the D1 database — copy the printed database_id.
npx wrangler d1 create open-connector

# 2. Create the R2 bucket (name is fixed in wrangler.example.jsonc).
npx wrangler r2 bucket create open-connector-transit-files

# 3. Generate three secrets (do NOT paste them into a terminal that logs history;
#    pipe straight into `gh secret set`). Examples:
openssl rand -hex 32   # -> OOMOL_CONNECT_ADMIN_TOKEN
openssl rand -hex 32   # -> OOMOL_CONNECT_RUNTIME_TOKEN
openssl rand -hex 32   # -> OOMOL_CONNECT_ENCRYPTION_KEY
```

### Repo secrets to set (on `jacksonw111/better-agent`)

| Secret | Value |
|---|---|
| `OC_D1_DATABASE_ID` | the `database_id` printed by `wrangler d1 create` |
| `OC_ADMIN_TOKEN` | random 32-byte hex — gates open-connector `/api/*` |
| `OC_RUNTIME_TOKEN` | random 32-byte hex — gates `/v1/*` + `/mcp` |
| `OC_ENCRYPTION_KEY` | random 32-byte hex — AES-256-GCM for stored provider credentials |

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` already exist (shared with the other Workers
deploys). Set the new ones, e.g.:

```bash
gh secret set OC_D1_DATABASE_ID  --repo jacksonw111/better-agent --body '<database_id>'
gh secret set OC_ADMIN_TOKEN     --repo jacksonw111/better-agent < <(openssl rand -hex 32)
gh secret set OC_RUNTIME_TOKEN   --repo jacksonw111/better-agent < <(openssl rand -hex 32)
gh secret set OC_ENCRYPTION_KEY  --repo jacksonw111/better-agent < <(openssl rand -hex 32)
```

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

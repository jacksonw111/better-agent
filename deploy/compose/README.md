# better-agent via docker-compose (single server)

Runs **postgres, redis, server (API), web, admin, the three MCP servers
(`mcp` / `finance-mcp` / `weread-mcp`), and a Caddy reverse proxy** on one
machine. **Only authz stays exclusively on Cloudflare Workers** — the server
calls it over its public URL (`AUTHZ_URL`).

**The MCP servers run in BOTH places.** They still deploy to Cloudflare Workers
(`deploy-test.yml`, from `src/worker.ts`) *and* now run here as Node containers
(from `src/server.ts` via `@hono/node-server`) — the same Hono app either way.
Pick per user in `mcp_servers`: point each row's URL at the Workers URL
(`*.workers.dev`) or at the Caddy MCP domain below. The Node entry injects
`process.env` as the request env so `c.env.*` (API_TOKEN, FRED_API_KEY,
WEREAD_API_KEY, …) resolves from the container's environment.

**Images are built in CI, not on the server.** The box is memory-constrained
and a local `docker build` OOMs, so GitHub Actions
(`.github/workflows/build-images.yml`) builds `server` / `web` / `admin` /
`mcp` / `finance-mcp` / `weread-mcp` on every push to `dev` and pushes them to
**ghcr.io**. This compose file only **pulls** those prebuilt images. The MCP
Dockerfile is one file parameterized by `--build-arg APP=` (`deploy/docker/mcp.Dockerfile`).

## Prerequisites
- Docker + docker compose.
- DNS A records → this server's IP for every domain in `.env`: the three app
  domains (`agent.` / `agent-api.` / `agent-admin.trendf.top`) **plus** the
  three MCP domains (`MCP_DOMAIN` / `FINANCE_MCP_DOMAIN` / `WEREAD_MCP_DOMAIN`) —
  all **DNS only / grey cloud** so Caddy can get certs.
- Ports 80 and 443 open (Caddy fetches Let's Encrypt certs on first start).
- An R2 bucket + an S3 API token (attachments stay on Cloudflare).
- A GitHub token with `read:packages` to pull the private images.

## Setup
```bash
cd deploy/compose
cp .env.example .env      # fill in domains, secrets, R2 creds

# One-time: log in so Docker can pull the private ghcr images.
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-username> --password-stdin

docker compose pull       # fetch server/web/admin from ghcr.io
docker compose up -d      # start (NO --build)
```
First run: pulls images, runs DB migrations (the `migrate` one-shot, which the
server waits on), then starts everything. Caddy provisions TLS certs
automatically once DNS resolves.

## Redeploy (after CI publishes new images)
```bash
docker compose pull       # grab the new :latest images
docker compose up -d      # recreate changed containers (re-runs migrate)
```
`VITE_SERVER_URL` is baked into the web/admin images at build time from the CI
repo variable `PUBLIC_API_URL` (currently `https://agent-api.trendf.top`) —
change it there, not in `.env`, and rebuild.

## Operate
```bash
docker compose logs -f server        # tail the API
docker compose down                  # stop (data persists in named volumes)
docker compose exec postgres pg_dump -U better_agent better_agent | gzip > backup.sql.gz
```

## Notes
- Migrations run automatically on every `up` (the `migrate` service exits 0
  before `server` starts). Adding a migration = publish new images, then pull + up.
- Pin a specific build with `IMAGE_TAG=<git-sha>` in `.env`; default tracks `:latest`.
- Data lives in the `pgdata` / `redisdata` named volumes — `down` keeps them,
  `down -v` deletes them.
- To disable the invite gate, leave `AUTHZ_URL` empty.
- MCP servers are stateless (no DB/redis). `finance-mcp` reads
  `FINANCE_MCP_API_TOKEN` (gate — empty = open), `FRED_API_KEY`, `ADANOS_API_KEY`;
  `weread-mcp` reads the optional `WEREAD_API_KEY` fallback; `mcp` needs no
  secret (per-request bearer token). To switch a user from Workers to compose,
  edit their `mcp_servers` row URL to the matching Caddy MCP domain — no data
  migration, no server code change.
- No k3s needed. If you later want HA/multi-node, the k3s manifests in
  `deploy/k8s` cover that; this compose file is the simple single-server path.

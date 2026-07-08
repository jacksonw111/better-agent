# Deployment & CI/CD

better-agent ships as three independently deployable targets: a self-hosted Docker Compose stack for single-server deploys, a k3s + kustomize stack for production, and Cloudflare Workers for the authz + mcp edge services. GitHub Actions builds the images, deploys the Workers, and releases the bridge CLI.

## Architecture

```
GitHub (dev push) ──▶ build-images.yml ──▶ ghcr.io/{server,web,admin}
                  ──▶ deploy-test.yml  ──▶ Cloudflare Workers (authz, mcp)

GitHub (main push) ──▶ deploy-prod.yml
                        ├─ build matrix → ghcr (sha + latest)
                        ├─ kubectl + sops/age → decrypt secrets, apply
                        ├─ pin images to sha via kustomize edit
                        ├─ migrate Job (gate) → wait for complete
                        └─ kubectl apply -k overlays/prod → rollout

GitHub (cli-v* tag) ──▶ release-cli.yml ──▶ 4 Bun --compile binaries
                                           + install.sh → GitHub Release
```

The split is deliberate: the stateful services (postgres, redis, server, web, admin) run on a server the operator controls (Docker Compose for small deploys, k3s for production), while the stateless edge services (authz invite gate, mcp tool proxy) stay on Cloudflare Workers where they were developed.

## Key Files

| File | Responsibility |
|------|----------------|
| `deploy/compose/docker-compose.yml` | Single-server stack: pgvector/pg18, redis, server/web/admin from ghcr, one-shot migrate, Caddy |
| `deploy/compose/Caddyfile` | Reverse proxy with auto-HTTPS for api/web/admin domains |
| `deploy/k8s/base/server.yaml` | Server Deployment (2 replicas, anti-affinity) + Service |
| `deploy/k8s/base/web.yaml` / `admin.yaml` | Web/Admin Deployments + Services |
| `deploy/k8s/base/postgres.yaml` | Postgres StatefulSet (pinned to one node), 10Gi PVC |
| `deploy/k8s/base/redis.yaml` | Redis Deployment + Service |
| `deploy/k8s/base/migrate-job.yaml` | One-shot migration Job (applied separately by CI before rollout) |
| `deploy/k8s/base/ingress.yaml` | Ingress for the three public domains |
| `deploy/k8s/base/backup-cronjob.yaml` | Scheduled pg backup |
| `deploy/k8s/base/kustomization.yaml` | Base resource list (migrate excluded — applied separately) |
| `deploy/k8s/overlays/prod/kustomization.yaml` | Prod overlay: configMap literals, image pins, postgres nodeSelector patch |
| `deploy/k8s/overlays/prod/cert-issuer.yaml` | Prod cert-manager issuer |
| `deploy/secrets/prod.secrets.example.yaml` | Plaintext template for the `app-secrets` Secret (encrypt in place with sops) |
| `.github/workflows/build-images.yml` | Dev-branch: typecheck gate + build/push server/web/admin to ghcr |
| `.github/workflows/deploy-test.yml` | Dev-branch: deploy mcp + authz Workers (authz migrates + seeds admin) |
| `.github/workflows/deploy-prod.yml` | Main-branch: build, sops-decrypt secrets, migrate, kustomize rollout |
| `.github/workflows/release-cli.yml` | `cli-v*` tag: Bun --compile 4 binaries + install.sh → GitHub Release |
| `apps/bridge-cli/install.sh` | Installer: platform detect, public/token download, install to ~/.better-agent/bin, PATH hint |

## Data Flow

### Docker Compose (self-hosted)

`deploy/compose/docker-compose.yml` is the small-deploy path. The images are **never built here** — the server is memory-constrained and would OOM — they are pulled from ghcr after `build-images.yml` publishes them.

Startup order is enforced through health gates:

1. **postgres** (`pgvector/pgvector:pg18`) — healthcheck `pg_isready`. PG18+ images use a versioned `pg_ctlcluster` layout, so the volume mounts at the parent `/var/lib/postgresql` (not `/data`); `PGDATA` is intentionally not set so PG18 uses its versioned default.
2. **redis** (`redis:7.4-alpine`, appendonly) — healthcheck `redis-cli ping`.
3. **migrate** — reuses the server image, runs `node dist/migrate.mjs` with `SKIP_ENV_VALIDATION=1` (migrate only needs `DATABASE_URL`), `depends_on.postgres.condition: service_healthy`, `restart: "no"`.
4. **server** — `depends_on.migrate.condition: service_completed_successfully` and redis healthy.
5. **web** / **admin** — depend on server.
6. **caddy** — depends on all three apps; serves 80/443, auto-HTTPS, routes by `API_DOMAIN`/`WEB_DOMAIN`/`ADMIN_DOMAIN`.

authz and mcp stay on Workers; the server reaches them over their public URLs (`AUTHZ_URL`, the user-configured MCP server URL).

### CI: `build-images.yml` (dev → ghcr)

Triggered on push to `dev`. Two jobs:

1. **check** — full-monorepo `pnpm check-types`. The per-image Docker builds only compile their own app, so this gate prevents a broken type from being baked into a published image.
2. **images** — a matrix of `{server, web, admin}`. Each builds with `deploy/docker/{server,app}.Dockerfile` (`APP` + `VITE_SERVER_URL` build args), pushes two tags (`latest` + `${{ github.sha }}`), and uses GHA build cache scoped per app.

### CI: `deploy-test.yml` (dev → Workers)

Two parallel jobs (mcp, authz), each `pnpm install --frozen-lockfile` then deploy:

- **mcp** — runs `pnpm -F mcp test` then `wrangler deploy` from `apps/mcp`.
- **authz** — migrates its own DB (`drizzle-kit migrate`), seeds the admin (`tsx src/seed-admin.ts`), builds the SPA, then `wrangler deploy` with secrets (`AUTHZ_DATABASE_URL`, `AUTHZ_JWT_SECRET`, `AUTHZ_SERVICE_SECRET`, `MAIN_SERVER_URL`).

### CI: `deploy-prod.yml` (main → k3s)

Triggered on push to `main`. Two jobs, strictly ordered:

1. **build** — same matrix as `build-images.yml`, tags `${sha}` + `latest` to `ghcr.io/<owner>/better-agent-{server,web,admin}`.
2. **deploy** (needs build):
   1. Write `PROD_KUBECONFIG` secret to `~/.kube/config`.
   2. **Decrypt + apply secrets**: download sops, `kubectl apply` the namespace, then `sops -d deploy/secrets/prod.secrets.yaml | kubectl apply -f -` using `SOPS_AGE_KEY`. Secrets are encrypted at rest with age and never exist in plaintext on disk or in git.
   3. **Pin images to this sha**: `kustomize edit set image` rewrites the three image refs in `overlays/prod/kustomization.yaml` from the `OWNER` placeholder to `${IMAGE_PREFIX}-<name>:${sha}`.
   4. **Migrate gate**: delete any stale `migrate` Job, sed the migrate Job's image to this sha, apply, and `kubectl wait --for=condition=complete --timeout=180s`. If migration fails, the job logs are printed and the workflow errors out — **no rollout happens on a failed migration**.
   5. **Rollout**: `kubectl apply -k overlays/prod`, then `rollout status` for server/web/admin (180s timeout each).

`concurrency.group: deploy-prod` with `cancel-in-progress: false` serializes prod deploys so two pushes can't race the migrate gate.

### Bridge CLI release

`release-cli.yml` triggers on `cli-v*` tags. `bun build --compile` embeds the Bun runtime into a self-contained binary, so no Node.js/npm is needed on the user's machine. Four targets are built in a loop:

| Target | Output |
|--------|--------|
| `bun-darwin-arm64` | `better-agent-bridge-darwin-arm64` |
| `bun-darwin-x64` | `better-agent-bridge-darwin-x64` |
| `bun-linux-x64` | `better-agent-bridge-linux-x64` |
| `bun-linux-arm64` | `better-agent-bridge-linux-arm64` |

`gh release create` attaches all four binaries plus `apps/bridge-cli/install.sh` with generated notes.

### `install.sh`

The installer (`apps/bridge-cli/install.sh`) detects OS (darwin/linux) and arch (x64/arm64), then resolves the download URL with a public/private fork:

- **Public repo / no token** — the `releases/latest/download/<asset>` shortcut works with no auth.
- **Private repo / `GITHUB_TOKEN` set** — that shortcut 404s for everyone; the installer resolves the asset id via the authenticated API (`python3` first, `grep` fallback) and fetches through the octet-stream endpoint.

It installs to `~/.better-agent/bin` (override with `INSTALL_DIR`), `chmod +x`, and prints a PATH hint for zsh/bash users whose install dir isn't already on `PATH`. The PATH pre-flight matters because the bridge CLI spawns agent CLIs (e.g. `claude-code`) that must themselves be on `PATH`.

## Design Rationale

- **Images built in CI, never on the server** — the self-hosted server is memory-constrained; building the monorepo there would OOM. Compose only `pull`s; CI owns the build.
- **Migrate as a one-shot gate** — in Compose it's a `service_completed_successfully` dependency; in k3s it's a Job the workflow waits on before rolling out. Either way, a failed migration blocks the deploy rather than shipping a schema-mismatched server.
- **sops + age for prod secrets** — secrets are encrypted at rest in git and decrypted only inside the CI run (via `SOPS_AGE_KEY`). No plaintext secret file is ever committed.
- **Image pins to sha, not `latest`** — the prod overlay is rewritten to the commit sha so a rollback is `git revert` + redeploy, and a deploy is reproducible. `latest` is a convenience tag, not the source of truth in prod.
- **PG18 volume at the parent dir** — PG18+'s `pg_ctlcluster` layout puts data in a versioned subdir; mounting the parent avoids breakage and leaves room for in-place major-version upgrades. The base k8s manifest still uses PG16 with an explicit `PGDATA` (fresh volume, no migration), so the two deploy paths are independent.
- **Workers for stateless edge, server for stateful core** — authz (invite gate) and mcp (tool proxy) are stateless or have their own DB and benefit from Workers' global edge; the core (postgres, sessions, agents) needs a single stateful home.
- **Bun `--compile` for the CLI** — one self-contained binary per platform means the install story is `curl | bash` with zero runtime prerequisites, and the PATH pre-flight is the only setup friction.
- **Public/private install fork** — the same `install.sh` works for a public repo (no token, shortcut URL) and a private repo (token + API asset lookup), so the installer doesn't need to be forked when visibility changes.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| Compose PG image | `deploy/compose/docker-compose.yml:25` | `pgvector/pgvector:pg18` | pgvector for memory embeddings |
| Compose PG volume mount | `deploy/compose/docker-compose.yml:32` | `/var/lib/postgresql` | Parent dir — PG18 versioned layout |
| Compose image tag | `deploy/compose/docker-compose.yml:54` | `${IMAGE_TAG:-latest}` | Override to pin a sha |
| k8s server replicas | `deploy/k8s/base/server.yaml:7` | 2 | With pod anti-affinity |
| k8s postgres storage | `deploy/k8s/base/postgres.yaml:46` | 10Gi | `volumeClaimTemplates` |
| k8s postgres image | `deploy/k8s/base/postgres.yaml:18` | `postgres:16.6-alpine` | Explicit `PGDATA=/var/lib/postgresql/data/pgdata` |
| Prod image tag | `deploy/k8s/overlays/prod/kustomization.yaml:20` | `latest` | Rewritten to sha by CI `kustomize edit set image` |
| Prod postgres node pin | `deploy/k8s/overlays/prod/kustomization.yaml:28` | `NODE1_HOSTNAME` | local-path volumes are node-local |
| Migration timeout | `.github/workflows/deploy-prod.yml:96` | 180s | `kubectl wait --for=condition=complete` |
| Rollout timeout | `.github/workflows/deploy-prod.yml:102` | 180s | Per deployment |
| Concurrency (prod) | `.github/workflows/deploy-prod.yml:9` | `deploy-prod`, `cancel-in-progress: false` | Serializes deploys |
| CLI release tag pattern | `.github/workflows/release-cli.yml:13` | `cli-v*` | Triggers the release workflow |
| CLI install dir | `apps/bridge-cli/install.sh:16` | `~/.better-agent/bin` | Override with `INSTALL_DIR` |
| CLI owner/repo | `apps/bridge-cli/install.sh:14` | `jacksonw111/better-agent` | Override with `OWNER_REPO` |

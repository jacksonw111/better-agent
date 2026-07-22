# better-agent MCP servers (Hono on Node) — one Dockerfile, three apps.
# Build with: --build-arg APP=mcp|finance-mcp|weread-mcp
#
# These apps also still deploy to Cloudflare Workers (src/worker.ts, via
# deploy-test.yml). This image runs the SAME Hono app under Node through the
# src/server.ts entry (@hono/node-server), which injects process.env as the
# request env so `c.env.*` (API_TOKEN, FRED_API_KEY, WEREAD_API_KEY, …) resolves.
FROM node:22-alpine AS build
ARG APP=mcp
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -F ${APP} build
# Pruned production node_modules for the app (workspace deps included).
# --legacy: pnpm v10 only deploys injected workspaces by default; we don't use
# injection, so keep the copy-based legacy deploy.
# --ignore-scripts: the runtime is prebuilt (dist/server.mjs), so dependency
# postinstalls aren't needed — and some fail on alpine.
RUN pnpm --filter=${APP} deploy --prod --legacy --ignore-scripts /out \
  && cp -r apps/${APP}/dist /out/dist

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# All MCP containers listen on 3000 (compose sets PORT=3000); the outer Caddy
# reverse-proxies to <service>:3000. Without PORT the app falls back to its
# per-app default (3004/3005/3006) used for local `wrangler`-free runs.
ENV PORT=3000
COPY --from=build /out .
EXPOSE 3000
CMD ["node", "dist/server.mjs"]

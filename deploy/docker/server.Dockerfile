# better-agent API server (Hono on Node) — also carries dist/migrate.mjs and
# the drizzle migrations folder for the k8s migrate Job.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -F server build
# Pruned production node_modules for the server app (workspace deps included).
# --legacy: pnpm v10 only deploys injected workspaces by default; we don't use
# injection, so keep the copy-based legacy deploy.
# --ignore-scripts: the runtime is prebuilt (dist/index.mjs), so dependency
# postinstalls aren't needed — and some (lefthook needs git, workerd needs glibc)
# fail on alpine. The root install above already runs script-free (pnpm 10
# default), so this just keeps deploy consistent with it.
RUN pnpm --filter=server deploy --prod --legacy --ignore-scripts /out \
  && cp -r apps/server/dist /out/dist \
  && cp -r packages/db/src/migrations /out/migrations \
  && cp -r apps/server/src/builtin-skills /out/builtin-skills

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV MIGRATIONS_DIR=/app/migrations
ENV BUILTIN_SKILLS_DIR=/app/builtin-skills
COPY --from=build /out .
EXPOSE 3000
CMD ["node", "dist/index.mjs"]

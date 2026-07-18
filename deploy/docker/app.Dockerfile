# better-agent web/admin — a pure client SPA (TanStack Start, prerendered shell,
# not_found_handling = single-page-application). Built to static assets in
# .output/public and served by Caddy with a SPA fallback — NO SSR node server.
# Build with: --build-arg APP=web|admin --build-arg VITE_SERVER_URL=https://api.<domain>
FROM node:22-alpine AS build
ARG APP=web
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -F ${APP} build
# The prerendered shell is the SPA entry; unmatched routes fall back to it so
# client-side routing works (same as the Workers single-page-application mode).
RUN cp apps/${APP}/.output/public/_shell.html apps/${APP}/.output/public/index.html

FROM caddy:2.8-alpine
ARG APP=web
COPY --from=build /repo/apps/${APP}/.output/public /srv
# Static file server with SPA fallback on :3000 (the outer Caddy reverse-proxies
# to this container). Hashed /assets get immutable caching and NO SPA fallback —
# a missing chunk must 404, not come back as index.html with a text/html MIME
# (which breaks module loading after a deploy swaps the chunk graph). Everything
# else falls back to the shell with no-cache so clients pick up new builds.
RUN printf ':3000 {\n\troot * /srv\n\t@assets path /assets/*\n\thandle @assets {\n\t\theader Cache-Control "public, max-age=31536000, immutable"\n\t\tfile_server\n\t}\n\thandle {\n\t\theader Cache-Control "no-cache"\n\t\ttry_files {path} /index.html\n\t\tfile_server\n\t}\n}\n' > /etc/caddy/Caddyfile
EXPOSE 3000

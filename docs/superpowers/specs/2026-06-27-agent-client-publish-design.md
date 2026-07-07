# Publishable `@jacksonw111/agent-client` — Design Spec

**Date:** 2026-06-27
**Status:** Approved (design)

## Goal

Turn the repo-private `@better-agent/client` package into a standalone, publishable npm SDK named **`@jacksonw111/agent-client`**, released to the public npm registry via a tag-triggered GitHub Action. Ship a README that shows a third party how to connect to the Better Agent server with an agent token.

## Why this is possible cleanly

The package's only "private" / server-side imports are **type-only**:

| import | kind | runtime? |
|---|---|---|
| `@orpc/client`, `@orpc/client/fetch` | value (`createORPCClient`, `RPCLink`) | yes |
| `@orpc/server` (`RouterClient`) | `import type` | no — type only |
| `@better-agent/api/routers/index` (`AppRouter`) | `import type` | no — type only |

So the build can inline the `AppRouter` type into the emitted `.d.ts`, and the published package needs **no dependency on the private server code**.

## Architecture

### Dependency classification (published `package.json`)

- `dependencies`: `@orpc/client`, `@orpc/server` — `@orpc/client` is runtime; `@orpc/server` stays a real dep so the emitted `.d.ts`'s `RouterClient<…>` reference resolves for consumers. Both pinned to the catalog version (`^1.13.14`); `pnpm publish` rewrites `catalog:` → the real range.
- `devDependencies`: `@better-agent/api` (workspace) — type-only, **inlined** into our `.d.ts` by the build, then dropped from the published manifest. Also `tsup`, `typescript`, `@types/node`, `vitest`, `@better-agent/config`.
- `@better-agent/api` MUST NOT remain in `dependencies` — `pnpm publish` would try to resolve `workspace:*` to a version and fail (api is private/unversioned).

### Dev-source / publish-dist split

Keep workspace consumers importing TypeScript source (current fast behavior, no build step in dev); only the **published tarball** points to `dist`:

```jsonc
// stays for workspace dev
"exports": { ".": { "default": "./src/index.ts" } },
// pnpm applies these overrides ONLY when publishing
"publishConfig": {
  "access": "public",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

### Build

`tsup` produces `dist/index.js` (ESM), `dist/index.cjs` (CJS), and `dist/index.d.ts` with bundled types (`dts: true` resolves and inlines `AppRouter`/`RouterClient`). Config: entry `src/index.ts`, `format: ["esm","cjs"]`, `dts: true`, `clean: true`, `treeshake: true`. `"files": ["dist"]`.

### Rename

`@better-agent/client` → `@jacksonw111/agent-client` across **11 files** (3 `package.json` workspace refs in apps/web, apps/admin, packages/ui; 8 source import sites). Mechanical find/replace, verified by typecheck + build. Workspace refs stay `"@jacksonw111/agent-client": "workspace:*"`.

### Release workflow

`.github/workflows/release-client.yml`, `on: push: tags: ["client-v*"]`:
checkout → pnpm/node → `pnpm install --frozen-lockfile` → `pnpm -F @jacksonw111/agent-client build` → `pnpm -F @jacksonw111/agent-client publish --access public --no-git-checks`, with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` and an `.npmrc` writing `//registry.npmjs.org/:_authToken`. **Prereq (user):** add `NPM_TOKEN` repo secret; the `@jacksonw111` npm org exists (user owns it).

### package.json metadata

`name`, `version: "0.1.0"`, remove `private`, `description`, `license: "MIT"` (+ `LICENSE` file), `repository` (`github.com/jacksonw111/better-agent`, `directory: packages/client`), `keywords`, `sideEffects: false`.

## README (`packages/client/README.md`)

Must show real connection usage:

```ts
import { createAgentClient } from "@jacksonw111/agent-client";

const agent = createAgentClient({
  // server root; the SDK appends "/rpc". Default deployed server:
  baseURL: process.env.BETTER_AGENT_URL ?? "https://better-agent-server.jacksonwen001.workers.dev",
  token: process.env.BETTER_AGENT_TOKEN!, // agent token (returned when an agent is created)
});

// one-shot
const reply = await agent.run("Hello");

// streaming
for await (const event of agent.stream("Hello")) {
  // handle run events (text deltas, tool calls, …)
}

// sessions
const { sessionId } = await agent.createSession();
await agent.run("continue", { sessionId });
const history = await agent.listMessages(sessionId);
await agent.cancel(sessionId);
```

Sections: install, quick start (above), `BETTER_AGENT_URL` note (server root, `/rpc` auto-appended; local `http://localhost:3000`; deployed `https://better-agent-server.jacksonwen001.workers.dev`), where the agent `token` comes from, the `AgentClient` method surface, and a note that types are fully inferred from the server router (bundled, no extra install).

## Testing / verification

- `pnpm -F @jacksonw111/agent-client test` (existing vitest: `index.test.ts`, `cancel.test.ts`) still passes after rename.
- `pnpm -F @jacksonw111/agent-client build` emits `dist/index.{js,cjs,d.ts}`; `dist/index.d.ts` contains the inlined `AppRouter` shape and has **no** `import … from "@better-agent/api"`.
- `npm pack --dry-run` (or `pnpm pack`) shows the tarball contains only `dist` + `README` + `LICENSE` + `package.json`, and the manifest's `dependencies` are just `@orpc/*` (no `@better-agent/api`).
- Repo-wide `pnpm check-types` + `pnpm -F web build` + `pnpm -F admin build` pass after the rename.

## Revisions during implementation (as built)

The "bundle the whole `AppRouter` type" plan above proved messy in practice: a
declaration bundler inlining the router's full inferred return types dragged in
unrelated server internals (an `@ai-sdk/provider` `LanguageModelV3` leak) and
collided the exported `Message`/`RunEvent` names. The shipped design instead
re-uses the server's own canonical domain types, which are small and clean:

- **Type sources.** `Message`, `MessagePart`, `RunEvent`, etc. are re-exported
  from `@better-agent/agent/session/{types,events}` (the exact shapes the server
  returns) rather than derived via `Awaited<ReturnType<RouterClient<AppRouter>…>>`.
  The run result is its own type — `RunResult = Message & { structured: unknown }`
  — to avoid colliding with the canonical `Message` used inside `MessageHistory`.
- **File split.** `src/types.ts` (public types) → `src/internal.ts` (the impl,
  the `RouterClient<AppRouter>` `Client` type, and the workspace-only
  `createAgentClientFrom`/`createUserSessionClientFrom` helpers) → `src/index.ts`
  (public re-exports: types + `createAgentClient` + `dispatchToolCall`). No import
  cycle; `AppRouter` never reaches an exported signature, so it stays out of the
  published `.d.ts`.
- **`.d.ts` build.** tsup builds JS only (`dts: false`); the declaration is built
  by **dts-bundle-generator** (`tsconfig.dts.json` with `paths` mapping
  `@better-agent/*` to source so it compiles the monorepo's bundler-mode `.ts`).
  It inlines `@better-agent/agent` and keeps `@orpc/*` external → a 178-line,
  zero-leak `index.d.ts`.
- **`/internal` subpath.** Exposed in dev `exports` (workspace consumers — only
  `apps/web/src/utils/chat-client.ts` uses it) but omitted from `publishConfig`,
  so the published package's public surface is just `.`.
- **pnpm pack + private workspace deps.** `@better-agent/{agent,api,config}`
  remain client `devDependencies` (workspace consumers compile client's source
  and must resolve them). pnpm pack rewrites `workspace:*` only if the target has
  a `version`, so `packages/api` was given `version: "0.0.0"` (agent/config
  already had one). Result: published `dependencies` are `@orpc/*` only; the
  `@better-agent@0.0.0` entries sit in `devDependencies`, which npm never installs
  for a consumed package.

## Out of scope

Publishing `@better-agent/api` (not needed — type bundled). Changesets/automated version bumping (manual version edit + tag). Backward-compat alias for the old `@better-agent/client` name (internal-only rename).

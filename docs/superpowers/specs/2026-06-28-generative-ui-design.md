# Generative UI Design

**Status:** Design / spec (pre-implementation)
**Date:** 2026-06-28
**Authors:** jackson + Claude

## Goal

Let an agent drive **generative UI**: a client registers its own component
library, sends a turn through the agent client, and the agent returns a
declarative JSON UI tree that the client renders with its own components. Data
access happens through client-side tools; the view is delivered as structured
output. The agent adapts to whatever component vocabulary the client registers —
the library is **client-defined and pluggable**, which fits our multi-tenant
agent platform (each consumer brings its own components).

This design also resolves two hard problems surfaced during brainstorming:

1. **Per-turn token cost** of re-sending a large component schema every turn.
2. **Component-level streaming** ("partial object streaming") so the UI reveals
   progressively instead of popping in fully formed.

## Non-goals (v1)

- A built-in/standard component library shipped by us. The library is the
  client's; we ship the contract machinery, not the components.
- Two-way state binding (AG-UI-style shared state). Deferred — overkill for v1.
- Progressive disclosure / schema retrieval. Designed below but **phase 2**;
  v1 relies on prompt caching + schema minification.

## Background: what already exists

The design leans on primitives the agent already ships — no new core agent
capability is required for the basic loop:

| Need | Existing primitive |
|---|---|
| Client-side data access | **Client tools** (`ClientToolDef.execute` runs locally against the client's DB; the agent emits `tool-call`, the client executes and `submitToolResult`) |
| The "contract language" | **`outputSchema`** (a JSON Schema passed per turn) |
| The JSON UI tree | **Structured output** — a synthetic `StructuredOutput` tool (`toolChoice:"required"`, `stopWhen` on that tool) whose call args carry the final JSON |

Relevant current facts (verified in code):

- `packages/agent/src/session/structured-output.ts` — `StructuredOutput` tool
  carries `parameters: outputSchema`; the model sees the full schema (including
  any `description`s on union branches) as the tool's parameters.
- `packages/agent/src/session/runtime.ts` — the `StructuredOutput` tool is
  **injected last** into the tool list.
- `packages/agent/src/tool/registry.ts` — `buildTools(..., {cacheLastToolDef:true})`
  tags the **last** tool def with `anthropic.cacheControl:{type:"ephemeral"}`.
  → The component schema already lands inside Anthropic's cacheable prefix.
- `packages/agent/src/provider/cache-policy.ts` — Anthropic uses breakpoints
  (`cacheToolDefs:true`); OpenAI/xAI use `promptCacheKey:sessionId`; Google `none`.
- `packages/agent/src/session/runtime-drain.ts` — `drainStream` iterates
  `result.fullStream` and currently **ignores** `tool-input-delta` chunks
  (they fall through to the no-op `applyStateChunk`). This is the hook point
  for partial streaming.
- `packages/agent/src/session/events.ts` — `RunEvent` has no partial/structured
  delta variant yet.

## Architecture

```
Client defines component library  ──derive──▶  outputSchema (fed to model)
   (the "contract language")          └─────▶  registry + validate (render/validate)
        │
        ▼
client.run(userText, { outputSchema, tools: dataTools, sessionId })
        │
   agent reasons ─▶ calls data tools (client hits its own DB, returns)
                 ─▶ calls StructuredOutput (produces UI tree)
        │
        ▼
SDK validates tree ─▶ renderer walks it, type→component ─▶ render
        │
   user interacts ─▶ action routing:
                      target:"client" → local handlers[intent](payload)
                      target:"agent"  → new turn, agent re-renders
```

## Contracts

Three artifacts, one source of truth.

### 1. ComponentDef — what the client registers (the "contract language")

```ts
interface ComponentDef {
  type: string            // discriminant, e.g. "Card" | "Form" | "DataTable"
  description: string     // selection guidance → written into the schema branch's `description`
  props: ZodSchema        // typed props → compiled into the schema branch
  children?: boolean      // whether this component accepts child nodes (container vs leaf)
  actions?: string[]      // intent names this component may emit
}
```

### 2. UINode — what the agent produces (structured output)

```ts
type UINode = {
  id: string                                              // model-emitted, stable render key
  type: string
  props: Record<string, Json>
  children?: UINode[]                                     // recursive; JSON Schema self-ref `$ref:"#"`
  action?: { intent: string; target: "agent" | "client"; payload?: Json }
}
```

`id` is required so the renderer can key nodes stably across partial-stream
updates (never key by array index).

### 3. SDK surface (client-side)

```ts
const ui = defineComponents([...defs])
//   ui.outputSchema   → pass to run/stream as outputSchema
//   ui.validate(json) → validates + narrows to UINode (final tree only)
//   ui.components     → the registry, type → ComponentDef (for the renderer)
```

`defineComponents` lives in the framework-agnostic SDK
(`@jacksonw111/agent-client`). The React renderer lives in `@better-agent/ui`.

### Schema derivation

`defineComponents` compiles the manifest into one recursive
discriminated-union JSON Schema:

- A `UINode` = a union over `{type, props}` branches, one per `ComponentDef`,
  each branch's `description` carrying the component's selection guidance.
- `children` (when a component allows it) is `array of UINode` via a `$ref` to
  the root node definition (`$defs` + `$ref:"#/$defs/UINode"`).
- `action` is an optional object on interactive branches.

The schema is the contract **and** the model's documentation in one — no
separate prompt-injection channel is needed; the model reads it as the
`StructuredOutput` tool's parameters.

## Interaction model (A2: local/semantic routing)

Each interactive component declares actions; each emitted `action` carries a
`target`:

- **`target:"client"`** — the SDK looks up a client-registered handler
  (`handlers[intent](payload)`) and runs it locally: navigate, toggle, fill,
  call a client tool, mutate local state. No model round-trip.
- **`target:"agent"`** — the SDK opens a follow-up turn. v1 formats the event
  as a synthetic user message (e.g. `[ui-event] intent=<x> payload=<json>`) and
  the agent's system prompt documents the convention. **No wire-protocol change.**
  The agent re-renders a fresh tree.

This sits between "render once" and "agent-in-the-loop for everything": cheap
local interactions stay local; only semantic actions cost a model turn.

## Token cost mitigation (layered)

The component schema is re-tokenized into the model's context every turn (the
model is stateless), so a large library is expensive on long conversations.
Two costs, addressed separately:

- **Wire cost** (client→server bytes) — minor; only "per-session registration"
  touches it, and it does **not** reduce model token cost.
- **Model input-token cost** — the expensive one; only context-side techniques
  (caching, retrieval, minification) touch it.

### L1 — Prompt caching (baseline; ship in v1)

The `StructuredOutput` tool already sits in Anthropic's cacheable
`tools→system→messages` prefix with an ephemeral breakpoint on the last tool.
Requirements to actually hit cache:

- **Deterministic serialization**: emit the schema with sorted keys so the
  prefix is byte-identical across turns. A non-deterministic `JSON.stringify`/
  map-iteration order silently invalidates the cache.
- **Manifest stability**: the component library must be identical across turns
  within a session. Changing it mid-session invalidates tools+system+messages.
- **TTL**: 5-min default; use `ttl:"1h"` when conversations have multi-minute
  gaps.
- **Verify**: assert `cache_read_input_tokens > 0` after turn 1 in a test.

Economics (Opus 4.8, $5/MTok in): cache read = 0.1×, write = 1.25× (5m) /
2× (1h). A 20K-token schema over 30 turns drops from ~$3.00 (uncached) to
~$0.42 (cached) — ~86% off. OpenAI/xAI rely on automatic prefix caching;
Google has no caching here (either accept the cost or use L3).

### L2 — Schema minification (opportunistic; low risk)

Trim verbose `description`s, drop `examples`, dedup repeated shapes via
`$ref`/`$defs`. Drop validation-only constraints (`minLength`, `maximum`, …)
from the schema sent to the model and enforce them client-side instead.
Helps wire and token cost linearly.

### L3 — Progressive disclosure (phase 2; deferred)

For very large libraries. **Accuracy note:** Anthropic's `defer_loading` /
tool-search applies to *callable input tools*; our components are union
branches of one *output* tree, not callable tools. So our progressive
disclosure is **two-phase output-schema narrowing**:

1. Send a compact index (component `type` + one-line description only) and let
   the model select the component types it needs.
2. Rebuild a reduced output schema containing only the selected branches; the
   model produces the tree against that.

Cost: one extra round-trip. **Threshold heuristic:** stay on L1+L2 while the
schema ≲ 10–15K tokens or fewer than ~30–50 components; switch to L3 when the
schema exceeds ~10K tokens **and** only a handful of components are used per
turn (also rescues selection accuracy, which caching does nothing for).

## Component-level streaming (partial object streaming)

Reveal the UI progressively as the `StructuredOutput` tool's args stream,
rather than waiting for the final object.

**Approach (chosen): stream the `StructuredOutput` tool's input-arg deltas.**
Do **not** switch to AI SDK `streamObject` — that is a separate top-level call
and would abandon the tool-loop / `stopWhen` multi-step design. AI SDK v5
already streams tool input args by default on `fullStream`
(`tool-input-start` → `tool-input-delta` → `tool-call`). This also aligns with
AG-UI's `TOOL_CALL_ARGS` model.

### Server (agent)

In `drainStream` (`runtime-drain.ts`):

1. Add a branch for `tool-input-delta` chunks **whose toolCallId is the
   `StructuredOutput` call** — accumulate `inputTextDelta` into a per-call
   buffer. (Ignore other tools' input deltas.)
2. Run `parsePartialJson` (AI SDK internal, or `partial-json-parser`) on the
   buffer to get a best-available **deep-partial** tree.
3. **Throttle**: coalesce deltas (e.g. one emit per animation frame / N ms) so
   the RunEvent stream isn't flooded.
4. Emit a new `RunEvent`:

```ts
| { type: "structured-delta"; partial: unknown; complete: false }
```

   On the final `tool-call`, the existing `done` event still carries the
   validated `structured` object as the source of truth (treat partials as
   optimistic display data that the final object replaces).

### Client (SDK + renderer)

- SDK forwards `structured-delta` partials to consumers.
- The renderer walks the partial tree, **keys nodes by `id`**, renders
  completed nodes, and shows the trailing incomplete node as a **skeleton**
  until it stabilizes (commit-on-complete).
- The UI must be **deep-partial tolerant** — never Zod-validate mid-stream;
  every field is possibly-undefined.
- Honor `prefers-reduced-motion` for the reveal animation.

### Pitfalls to handle

1. Only buffer/parse the **StructuredOutput** toolCallId.
2. Partials are **unvalidated** — guard every field.
3. **Drop or skeleton** the trailing incomplete array element.
4. **Stable keys + commit-on-complete** to prevent flicker/re-mount.
5. **Throttle** emissions.
6. Final truth comes from the `done` event / final `tool-call`, which can
   replace the optimistic tree if validation fails.

## Error handling

- **Unknown component `type`** in the tree → render a fallback placeholder,
  skip the node; never crash.
- **Tree validation failure** (final object) → error boundary; optionally feed
  the validation error back to the agent as a follow-up turn so it can correct.
- **Untrusted output** — structured output via tool args is schema-constrained
  and usually valid, but the client still treats the tree as untrusted: no
  `eval`, cap tree depth/size, sanitize string props before render.
- **Action with no registered handler** (`target:"client"`) → log + no-op,
  surfaced in dev.

## Frontend integration (apps/web — first consumer)

apps/web is the first consumer and the test surface. It hosts a **dedicated
generative-UI playground route** (S1) so the capability is exercised end-to-end
in isolation, with the renderer built as a reusable component that can later
drop into chat (S2 graduation path).

Verified apps/web facts (so the integration matches existing patterns):
- TanStack file routes (`createFileRoute`), e.g. `apps/web/src/routes/index.tsx`.
- `apps/web/src/utils/chat-client.ts` → `userAgentClient(agentId)` =
  `createUserSessionClientFrom(client, agentId)`.
- Agents/sessions via React Query + `orpc` (`orpc.agents.list`,
  `orpc.userSessions`). The existing chat renders `<Conversation>` from
  `@better-agent/ui`.

### Surface

- Route `apps/web/src/routes/genui.tsx` (behind the normal web auth). Pick a
  demo agent (reuse the agent grid, or a fixed configured agent), get a client
  via `userAgentClient(agentId)`, render `<GenerativeUIView>`.
- `<GenerativeUIView>`: a prompt box + a live render area. On submit it calls
  `agentClient.stream(text, { sessionId, outputSchema: ui.outputSchema, tools })`
  and feeds `structured-delta` partials (then the final `structured`) into the
  renderer.

### The client-defined component library (apps/web owns this)

Co-located in `apps/web/src/genui/`:
- `library.tsx` — the manifest of `ComponentDef`s (type, description, props Zod,
  children, actions) **and** the React render implementation per type. Starter
  set (~12, representative yet under the L3 threshold): `Stack`, `Card`,
  `Heading`, `Text`, `Badge`, `Stat`, `Image`, `List`, `Table`, `Button`,
  `Form`, `TextField`, `Select`. Covers containers (children), leaves, typed
  props, and actions.
- `tools.ts` — mock data tools (`ClientToolDef[]`): e.g. `listTasks`,
  `getStats`, `searchItems` returning in-memory data, so the agent fetches then
  renders. Controllable and reproducible; swap for real data later.
- `handlers.ts` — local action handlers for `target:"client"` intents.

`const ui = defineComponents(manifest)` yields `ui.outputSchema` (to the model)
and `ui.components` (to the renderer).

### The renderer (@better-agent/ui, generic + reusable)

`packages/ui/src/components/genui/generative-ui.tsx`:

```ts
interface GenerativeUIProps {
  tree: unknown                                              // partial during stream, final after
  renderers: Record<string, React.ComponentType<NodeProps>> // type → component
  onAction: (action: { intent: string; target: "agent" | "client"; payload?: Json }) => void
}
```

Responsibilities: walk the tree, key nodes by `id`, render completed nodes,
show the trailing incomplete node as a skeleton (commit-on-complete), fall back
for unknown `type`, stay deep-partial tolerant, honor `prefers-reduced-motion`.
apps/web supplies `renderers` (from `library.tsx`) and `onAction`.

### Action wiring (A2)

`<GenerativeUIView>`'s `onAction`:
- `target:"client"` → run `handlers[intent](payload)` locally.
- `target:"agent"` → `agentClient.stream("[ui-event] intent=… payload=…",
  { sessionId, outputSchema, tools })` → re-render.

### Demo agent

Configure a "Generative UI Demo" agent in admin with a system prompt telling it
to fetch via the data tools first, then compose the registered components into a
UI tree via `StructuredOutput`. (There is no per-turn system-prompt channel; the
derived `outputSchema` already forces the tree — the prompt only improves
selection quality.)

### External consumers

The SDK (`@jacksonw111/agent-client`) stays framework-agnostic: it ships
`defineComponents` + partial-stream + `validate`. The React renderer lives in
`@better-agent/ui` (internal). External SDK consumers write their own renderer
(or a future published React-renderer package).

## Package boundaries

- `@jacksonw111/agent-client` (framework-agnostic SDK): `defineComponents`,
  schema derivation, `validate`, partial-stream forwarding, action routing
  helper. No React.
- `@better-agent/ui` (React): the generic `<GenerativeUI>` renderer that
  consumes `renderers` + partial/final trees, including skeleton/commit-on-
  complete, unknown-type fallback, and `onAction` dispatch.
- `apps/web` (first consumer): the `genui/` library (manifest + render impls),
  mock data tools, local action handlers, the `/genui` route, and
  `<GenerativeUIView>` (stream + partial + action wiring).
- `packages/agent`: the `structured-delta` event + `drainStream` branch +
  partial-JSON parse + throttle. The cache breakpoint already exists; add
  deterministic schema serialization.

## Testing strategy

- **Schema derivation**: manifest → JSON Schema round-trip; discriminated
  union shape; recursive `children` via `$ref`; descriptions present on branches.
- **Validation**: `ui.validate` accepts valid trees, narrows types, rejects
  unknown `type`.
- **Caching**: a test asserting `cache_read_input_tokens > 0` on turn 2 with an
  unchanged manifest (guards against a silent serialization invalidator).
- **Partial streaming**: feed synthetic `tool-input-delta` sequences through
  `drainStream`; assert monotonically-growing partial trees and a final
  `complete` matching the validated object; assert non-StructuredOutput tool
  deltas are ignored.
- **Partial parsing**: unterminated string/array/object buffers parse to the
  expected best-available value; trailing incomplete element dropped.
- **Action routing**: `target:"client"` invokes the local handler;
  `target:"agent"` opens a follow-up turn with the templated event message.
- **Renderer**: unknown `type` → fallback; stable keys across partial updates;
  trailing incomplete node renders as skeleton then commits.
- **Web smoke (apps/web)**: the `/genui` route mounts; submitting a prompt
  streams a tree that renders with the starter library; a `Button`/`Form`
  action fires its handler (client) or a follow-up turn (agent).

## Phasing

**Phase 1 (this spec's core):**
- `ComponentDef` / `UINode` contracts + `defineComponents` schema derivation.
- `outputSchema` + client-tools data loop (already supported; wire the UI path).
- Action routing (A2: local/semantic).
- Generic `<GenerativeUI>` renderer (`@better-agent/ui`) with unknown-type
  fallback.
- **apps/web playground**: `genui/` library (~12 components) + mock data tools +
  local handlers + `/genui` route + `<GenerativeUIView>` + a demo agent. This is
  the testable surface.
- L1 caching (deterministic serialization + verify) + L2 minification.

**Phase 1.5 (same effort, high value):**
- Component-level streaming: `structured-delta` event + `drainStream` branch +
  partial parse + throttle + skeleton/commit-on-complete renderer + the
  playground consuming partials.

**Phase 2 (deferred / 待定):**
- L3 progressive disclosure (two-phase output-schema narrowing) for very large
  libraries.
- Per-session manifest registration by hash (wire-cost only).
- Two-way state binding (AG-UI-style), if ever needed.

## Resolved decisions

- **Use case:** client-defined, pluggable component library (multi-tenant).
- **First consumer / test surface:** apps/web, a dedicated `/genui` playground
  route (S1), with the renderer built reusable for a later move into chat.
- **Mechanism:** A — component manifest → SDK-derived schema (one source of
  truth; descriptions embedded in the schema).
- **Interaction:** A2 — actions declare `target: "agent" | "client"`; local
  stays local, semantic round-trips.
- **Streaming:** stream the `StructuredOutput` tool's input-arg deltas (not
  `streamObject`); new `structured-delta` event; commit-on-complete renderer.
- **Token cost:** L1 caching baseline + L2 minification in v1; L3 progressive
  disclosure deferred.

# Agent Client SDK

The Agent Client SDK (`packages/client/`, published as `@jacksonw111/agent-client`) is a TypeScript client for the better-agent server. It provides a small surface — create sessions, run a turn, stream a turn, cancel, upload/fetch attachments, list history — over a fully-typed oRPC link, plus a client-side tool-dispatch loop that lets the caller execute local tools in response to server-emitted `tool-call` events.

## Architecture

The SDK is a thin façade over the server's typed router client. There are two planes, two constructors, and one streaming primitive:

```
createAgentClient({ baseURL, token })        agent token plane (sessions router)
        │
        ▼
createAgentClientFrom(client)                 ─┐
createUserSessionClientFrom(client, agentId)   │→ AgentClient interface
                                              ─┘   createSession / run / stream
                                                   cancel / listMessages
                                                   uploadAttachment / getAttachment

stream(text, opts) ─▶ streamPromptWithTools ─▶ for await event of sessions.prompt
                         │   on tool-call: dispatchToolCall(tools, event, submit)
                         │       └─ tool.execute(args) → sessions.submitToolResult
                         └─ yields every RunEvent to the caller
```

The SDK never owns transport state beyond a single `RPCLink`. All authentication is a static `Authorization: Bearer <token>` header set at link construction. The `token` is either an agent token (`ba_…`, the agent plane) or — for the user plane — the user's access token is carried by the oRPC client the SDK is built from.

### The `AgentClient` interface

`AgentClient` (`packages/client/src/types.ts:60`) is the entire public surface:

```ts
interface AgentClient {
  cancel(sessionId: string): Promise<void>;
  createSession(): Promise<{ sessionId: string }>;
  getAttachment(id: string): Promise<Blob>;
  listMessages(sessionId: string): Promise<MessageHistory>;
  run(text: string, options?: RunOptions): Promise<RunResult>;
  stream(text: string, options?: RunOptions): AsyncGenerator<RunEvent>;
  uploadAttachment(sessionId: string, file: File): Promise<UploadedAttachment>;
}
```

`RunOptions` (`types.ts:41`) carries `sessionId?` (omit to auto-create a one-shot session), `signal?` (AbortSignal), `attachmentIds?`, and `tools?` (local `ClientToolDef[]` for the dispatch loop).

### Two planes

The server exposes two parallel session routers (see [13-cross-cutting.md]):

- **Agent plane — `sessions`**: scoped to an **agent token**. `createAgentClient` builds a link with `Bearer <agent token>` and calls `client.sessions.*`. Used by the bridge CLI and headless integrations.
- **User plane — `userSessions`**: scoped to a **user + agentId**. `createUserSessionClientFrom(client, agentId)` reuses an already-authenticated oRPC client (e.g. the web app's cookie/bearer client) and calls `client.userSessions.*` with `{ agentId }` on session creation. Used by the web chat.

Both factories produce the same `AgentClient` shape; the only difference is which server router they address and how the session is keyed. This lets the chat UI (`packages/ui`) be plane-agnostic — it only depends on `AgentClient`.

## Key Files

| File | Responsibility |
|------|----------------|
| `packages/client/src/index.ts` | Public exports — `createAgentClient`, `dispatchToolCall`, and all type re-exports |
| `packages/client/src/internal.ts` | `createAgentClient`, `createAgentClientFrom`, `createUserSessionClientFrom`, `dispatchToolCall`, `runWithTools` |
| `packages/client/src/types.ts` | `AgentClient`, `AgentClientConfig`, `RunOptions`, `ClientToolDef`, re-exports of `RunEvent`/`Message*` from the agent package |
| `packages/client/src/tool-stream.ts` | `streamPromptWithTools` — the stream + dispatch loop |
| `packages/client/src/downscale.ts` | `downscaleImage` — client-side image resize before upload |
| `packages/client/package.json` | `exports` map (`.`, `./internal`), build via tsup + dts-bundle-generator |

## Data Flow

### Creating the client

`createAgentClient({ baseURL, token })` (`internal.ts:210`):

1. Build an `RPCLink` at `${baseURL}/rpc` with `headers: { authorization: "Bearer " + token }`.
2. `createORPCClient(link)` → a fully-typed `RouterClient<AppRouter>`.
3. `createAgentClientFrom(client)` wraps it in the `AgentClient` interface.

`createUserSessionClientFrom(client, agentId)` (`internal.ts:164`) takes an *existing* typed client (so the web app's token-refresh interceptor still applies) and binds every call to `client.userSessions.*`, threading `agentId` into `create`.

### `stream(text, options)` — the streaming protocol

Both planes route `stream` through `streamPromptWithTools` (`tool-stream.ts:42`):

1. `prompt({ sessionId, text, tools: strip(options.tools), attachmentIds }, { signal })` — call `sessions.prompt` (or `userSessions.prompt`). The `tools` are stripped to `{ name, description, parameters }` only — the server tells the model about them but never receives `execute`.
2. Iterate the returned `AsyncIterable<RunEvent>`. **Yield every event to the caller.**
3. On a `tool-call` event, when `options.tools` is set, push a `dispatchToolCall` promise onto a `dispatches` array — fire-and-forget during the stream, all awaited at the end.
4. `await Promise.all(dispatches)` before returning, so the generator doesn't resolve while a tool is still mid-submit.

`RunEvent` (`packages/agent/src/session/events.ts:4`) is the discriminated union the server emits:

| Type | Payload | Meaning |
|------|---------|---------|
| `message-start` | `messageId` | A new assistant message row was created |
| `text-delta` | `delta` | Incremental assistant text |
| `reasoning-delta` | `delta` | Incremental reasoning text |
| `step-finish` | — | One model step completed (tools may follow) |
| `tool-call` | `callId`, `toolName`, `args` | The model wants to call a (client) tool |
| `tool-result` | `callId`, `result`, `isError`, `name?` | A tool result landed (echoed back) |
| `done` | `usage`, `finishReason` | Turn completed |
| `error` | `message` | Turn failed |
| `title` | `title` | The session was auto-titled |

### Client tool dispatch

`dispatchToolCall` (`internal.ts:53`) finds the tool by name in the caller's `tools` array and executes it:

- **Not found** → `submit({ callId, result: "Tool <name> not found", isError: true })`. Never rejects.
- **Throws** → `submit({ callId, result: error.message, isError: true })`.
- **Success** → `submit({ callId, result, isError: false })`.

`submit` is wired (`tool-stream.ts:61`) to call `sessions.submitToolResult({ sessionId, callId, result, isError })`. The server then re-enters the model with the tool result, emitting further `text-delta`/`tool-call` events in the same stream — so a multi-tool turn is one `stream()` call with N dispatches happening concurrently on the client.

Because dispatches are pushed onto an array and awaited at the end (not awaited inline), the stream keeps yielding events while tools run, and the model's next step can begin as soon as the server has the result — the loop is pipelined, not strictly sequential.

### `run(text, options)` — one-shot

Without `tools`, `run` is a single `sessions.run({ sessionId, text, attachmentIds })` call that returns the final `Message` (`internal.ts:134`). With `tools`, `runWithTools` (`internal.ts:76`) drains the stream (dispatching tools as a side effect), then fetches `listMessages` and returns the last assistant message — because the stream's final event is `done`, not the message payload, the message itself must be read back from history.

### Attachments

`uploadAttachment(sessionId, file)` (`internal.ts:32`) first runs `downscaleImage(file)` (client-side resize to cap payload size), then calls `sessions.uploadAttachment({ sessionId, file })` → `{ id, mime, name, size }`. The returned `id` is passed as `attachmentIds` on the next `run`/`stream`. `getAttachment(id)` fetches the bytes back as a `Blob` (used by the chat UI to render images through an object URL).

## Design Rationale

- **oRPC typed client, not hand-written fetch** — the SDK is `RouterClient<AppRouter>` under the hood, so every input/output is type-checked against the server router at compile time. Adding a server procedure costs zero client glue.
- **Two constructors, one interface** — the agent plane and user plane differ only in router + session keying. Both return `AgentClient`, so the chat UI and tests are plane-agnostic.
- **`run` vs `stream` separation** — `run` is the simple case (no events, just the final message); `stream` is the full event stream. Tools work with either: `run` drains the stream and reads history, `stream` yields events and dispatches as a side effect.
- **Pipelined tool dispatch** — tool calls are dispatched concurrently during the stream, not awaited inline, so a slow tool doesn't block the model's next step or the event yield. The final `Promise.all` only guards the generator's resolution.
- **`dispatchToolCall` never rejects** — every failure path (missing tool, thrown error) becomes a structured `{ isError: true, result }` submit. The stream loop has no try/catch around dispatch, because there is nothing to catch.
- **Tools stripped to schema before send** — only `{ name, description, parameters }` crosses the wire; `execute` stays local. The server cannot accidentally execute a client tool.
- **Image downscale before upload** — resizing on the client caps bytes-in-flight and storage cost before the file ever hits the server.
- **Re-exported domain types** — `RunEvent`, `Message`, `MessagePart`, etc. are re-exported from `@better-agent/agent` so the SDK's public surface is self-contained and matches the server's exact shapes.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| RPC path | `packages/client/src/internal.ts:212` | `${baseURL}/rpc` | Appended to the user-supplied `baseURL` |
| Auth header | `packages/client/src/internal.ts:213` | `Bearer ${token}` | Static at link construction |
| Exports map | `packages/client/package.json:23` | `.`, `./internal` | `./internal` exposes `createUserSessionClientFrom` for workspace apps |
| Build target | `packages/client/package.json:51` | tsup + dts-bundle-generator | Bundles to `dist/index.{js,cjs}` + a single `index.d.ts` |
| Registry | `packages/client/package.json:38` | `npm.pkg.github.com` | Published as `@jacksonw111/agent-client` |

The `./internal` subpath export is intentional: workspace apps (web) need `createUserSessionClientFrom`, but external consumers should only see `createAgentClient`. The split keeps the public API narrow while letting first-party apps build user-plane clients.

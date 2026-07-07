# @jacksonw111/agent-client

TypeScript SDK for connecting to a **Better Agent** server — run agents, stream
events, and manage sessions over [oRPC](https://orpc.unnoq.com). Fully typed, with
the server's message and event shapes inferred for you. No `@better-agent/*`
packages required at runtime.

**Requirements:** Node 18+ (uses the global `fetch`) or any modern browser. Ships
both ESM and CommonJS, so `import` and `require` both work.

**You need two things to connect:** the server's URL (`BETTER_AGENT_URL`) and an
**agent token**. See [Connecting to the server](#connecting-to-the-server) for both.

## Install

This package is published to **GitHub Packages**, so installing it takes a one-time
setup: point the `@jacksonw111` scope at GitHub's registry and authenticate.

1. Add a `.npmrc` next to your `package.json`:

   ```ini
   @jacksonw111:registry=https://npm.pkg.github.com
   ```

2. Authenticate. GitHub Packages requires a token even for public packages — create
   a GitHub Personal Access Token with the **`read:packages`** scope and add it to
   your **user-level** `~/.npmrc` (keep it out of the project file):

   ```ini
   //npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
   ```

3. Install:

   ```bash
   npm install @jacksonw111/agent-client
   # or: pnpm add @jacksonw111/agent-client
   ```

## Quick start

```ts
import { createAgentClient } from "@jacksonw111/agent-client";

const agent = createAgentClient({
  // The Better Agent server root. The SDK appends "/rpc" for you.
  baseURL: process.env.BETTER_AGENT_URL ?? "https://better-agent-server.jacksonwen001.workers.dev",
  // An agent token — returned when the agent is created (see below).
  token: process.env.BETTER_AGENT_TOKEN!,
});

// One-shot run — returns the final assistant message (+ any structured output).
const result = await agent.run("Summarize today's standup notes.");
console.log(result); // { id, role: "assistant", ... , structured }
```

## Connecting to the server

### `BETTER_AGENT_URL`

`baseURL` is the **server root**, not the RPC endpoint — the SDK appends `/rpc`
itself. Point it at whichever server you talk to:

| Environment | `BETTER_AGENT_URL` |
| --- | --- |
| Local dev server | `http://localhost:3000` |
| Deployed (Cloudflare Workers) | `https://better-agent-server.jacksonwen001.workers.dev` |

```ts
const agent = createAgentClient({
  baseURL: process.env.BETTER_AGENT_URL!, // e.g. http://localhost:3000
  token: process.env.BETTER_AGENT_TOKEN!,
});
```

### The agent `token`

Each agent has its own token. **To get one, create an agent in the Better Agent
admin app — the token is shown once, at creation — or ask whoever runs your Better
Agent instance to issue you one.** The SDK sends it as `Authorization: Bearer <token>`
on every request, which is how the server identifies *which* agent the calls belong
to, so one token == one agent. Treat it like an API key: keep it secret and supply it
via an environment variable rather than hard-coding it.

## Streaming

`stream()` yields the run's events as they arrive (text deltas, reasoning, tool
calls, completion):

```ts
for await (const event of agent.stream("Write a haiku about Cloudflare.")) {
  switch (event.type) {
    case "text-delta":
      process.stdout.write(event.delta);
      break;
    case "error":
      console.error("\nrun failed:", event.message);
      break;
    case "done":
      console.log("\n— done", event.usage);
      break;
  }
}
```

Run failures (bad session, model/provider error, …) arrive as a terminal `error`
event and the stream then ends normally — the loop won't throw, so handle the
`"error"` case rather than wrapping it in `try/catch`. Other event types include
`reasoning-delta`, `tool-call`, `tool-result`, and `message-start`.

## Sessions

By default each `run`/`stream` creates a one-shot session. Pass a `sessionId` to
continue a conversation:

```ts
const { sessionId } = await agent.createSession();

await agent.run("My name is Ada.", { sessionId });
await agent.run("What's my name?", { sessionId }); // remembers "Ada"

const history = await agent.listMessages(sessionId); // full transcript with parts
await agent.cancel(sessionId); // stop an in-flight turn
```

## Local tools

Provide tools the **client** executes. When the model calls one mid-stream, the SDK
runs your `execute` and submits the result back to the server automatically:

```ts
const result = await agent.run("What's the weather in Tokyo?", {
  tools: [
    {
      name: "get_weather",
      description: "Get the current weather for a city.",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      execute: async (args) => JSON.stringify(await getWeather(args)),
    },
  ],
});
```

## Structured output

Pass a JSON Schema as `outputSchema`; the result carries a `structured` field:

```ts
const result = await agent.run("Extract the invoice total.", {
  outputSchema: { type: "object", properties: { total: { type: "number" } }, required: ["total"] },
});
console.log(result.structured); // { total: 1240.5 }
```

## API

`createAgentClient(config)` returns an `AgentClient`:

| Method | Description |
| --- | --- |
| `run(text, options?)` | Run one turn; resolves to the final assistant message (`RunResult`). |
| `stream(text, options?)` | Run one turn; async-iterates `RunEvent`s. |
| `createSession()` | Create a new session → `{ sessionId }`. |
| `listMessages(sessionId)` | Full history (`MessageHistory` — messages with parts). |
| `cancel(sessionId)` | Cancel the in-flight turn. |

`options` (`RunOptions`): `sessionId`, `signal` (`AbortSignal`), `tools`, `outputSchema`.

All types — `RunResult`, `RunEvent`, `Message`, `MessageHistory`, `MessagePart`,
`AgentClientConfig`, … — are exported and need no extra install.

## License

MIT

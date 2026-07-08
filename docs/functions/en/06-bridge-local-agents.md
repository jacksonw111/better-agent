# Bridge / Local Agents

The bridge connects a user's locally-installed coding agent (claude-code, opencode, codex, or pi) to the better-agent web UI. A standalone CLI binary (`better-agent-bridge`) drives the local agent, normalizes its output into a unified event model, and relays events↑ / commands↓ through a server-side rolling-window store. The web renders the live feed as a terminal-style chat, with capability-gated controls (model picker, interrupt, past conversations, usage chips).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web (browser)                                              │
│    Terminal → useBridgeTerminal → BridgeTransport                │
│      connectStream: SSE /bridge/sessions/:id/stream              │
│      history: persisted events (seed on load)                    │
│      sendInput: POST bridge.sendInput                            │
│    foldEventsToTurns → BridgeChatRow / WorkingSkeleton           │
│    capabilities(agentKind) gates every optional UI surface       │
└──────────────────────┬──────────────────────────────────────────┘
                       │  SSE (events↑) + oRPC (commands↓)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/server                                                     │
│    bridgeRouter (oRPC): startSession, pushEvents, pollCommands,  │
│      observe, history, sendInput, endSession, usageByAgentKind   │
│    RelayStore: Redis (prod) / in-memory (dev)                    │
│      events↑ channel + commands↓ channel per session             │
│      rolling window (MAX_WINDOW=500, WINDOW_TTL_SEC=900)         │
│    SSE route /bridge/sessions/:id/stream                         │
│      observeBridgeEvents: subscribe → read(afterId) → dedupe      │
│    best-effort persist to bridge_messages (appendMany)           │
└──────────────────────┬──────────────────────────────────────────┘
                       │  oRPC over fetch (Bearer bt_…)
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/bridge-cli (standalone Bun --compile binary)               │
│    parseArgs → selectAdapter(kind) → requireAgentCli (PATH check)│
│    createRelayTransport(serverUrl, token)                        │
│    transport.startSession → { sessionId, config }                │
│    adapter.start(dir, {resume, config}) → AgentHandle            │
│    runBridgeSession:                                             │
│      forwardEvents: agent.events → batched pushEvents (retry queue) │
│      pollLoop: pollCommands(afterId) → dispatchCommands → sink    │
│    SIGINT/SIGTERM → handle.stop()                                │
└──────────────────────┬──────────────────────────────────────────┘
                       │  SDK / JSON-RPC / stdio
                       ▼
              Local agent process
              (claude, opencode, codex, pi)
```

### Bridge CLI

`better-agent-bridge` is a standalone binary compiled with `bun --compile` (no Node.js needed). `install.sh` (`apps/bridge-cli/install.sh`) downloads the platform asset from GitHub Releases to `~/.better-agent/bin` and prints a PATH hint. It handles both public repos (releases/latest/download shortcut) and private repos (authenticated API asset resolution via `GITHUB_TOKEN`).

The entry point (`apps/bridge-cli/src/index.ts:27` `main`):

1. `parseArgs` (`args.ts:92`) — `--agent`, `--token`, `--server`, `--dir`, optional `--label`, `--resume`, `--opencode-transport`, `--debug`. Falls back to `BETTER_AGENT_BRIDGE_TOKEN` / `BETTER_AGENT_BRIDGE_SERVER` env vars and `process.cwd()`.
2. `selectAdapter` (`adapters/index.ts:49`) — picks the adapter for the agent kind; opencode honors `--opencode-transport` (default `acp`, opt-in `serve`).
3. `requireAgentCli` (`index.ts:15`) — PATH pre-flight: `findOnPath(cli.binary)` checks that the agent's CLI is installed. If missing, exits with a precise install hint (e.g. `npm i -g @anthropic-ai/claude-code`). The standalone binary bundles no agent CLI.
4. `transport.startSession` registers the session **before** `adapter.start` so the server can return the token's persisted startup `config` (Phase 4) in time for the adapter to apply it.
5. `runBridgeSession` (`relay-client.ts:183`) runs push + poll loops concurrently until the agent exits or `SIGINT`/`SIGTERM` fires. `handle.stop()` always runs in `finally`.

### Bridge adapters

Each adapter implements the `Adapter` interface (`adapters/types.ts:192`): `start(dir, opts?) → Promise<AgentHandle>`. The `AgentHandle` (`types.ts:115`) exposes `events` (an `AsyncIterable<NormalizedEvent>`), `send`, `stop`, and optional control methods (`interrupt`, `setModel`, `setPermissionMode`, `listSessions`, `getStatus`, `answerApproval`).

| Adapter | Transport | Key mechanism |
|---------|-----------|---------------|
| `claude-code` (`adapters/claude-code.ts`) | Claude Agent SDK `query()` | `pathToClaudeCodeExecutable: findOnPath("claude")` — the compiled binary omits the SDK's bundled claude, so it drives the user's PATH claude. `canUseTool` routes tool permissions to web approval events. `includePartialMessages: true` + `thinking: adaptive` for streaming reasoning. |
| `opencode` (`adapters/opencode.ts`) | ACP (`opencode acp`) over stdio JSON-RPC | `connectJsonRpc("opencode", ["acp"], dir)` → `initialize` → `session/new`. `session/update` notifications normalized; `session/request_permission` routed to approval registry. Model/mode via `unstable_setSessionModel` / `session/set_mode`. |
| `opencode-serve` (`adapters/opencode-serve.ts`) | `opencode serve` over HTTP + SSE | Opt-in (`--opencode-transport serve`). Spawns `opencode serve --port 0`, discovers the assigned port from stdout, then `fetch`-based HTTP. Unverified wire shapes (marked ASSUMPTION). |
| `codex` (`adapters/codex.ts`) | `codex app-server` JSON-RPC over stdio | `initialize` → `initialized` → `thread/start`. `turn/start` for sends, `turn/interrupt` for cancellation. Approval requests (`execCommandApproval`/`applyPatchApproval`) routed to registry. |
| `pi` (`adapters/pi.ts`) | `pi --mode rpc` custom JSON-over-stdio | `spawnProcessIo("pi", ["--mode", "rpc"], dir)`. No per-tool approval protocol at all. `session_ready` assembled from three RPC replies (`get_state`, `get_available_models`, `get_commands`). `getStatus` via `get_session_stats` + `get_state`. |

The `AGENT_CLI` table (`adapters/index.ts:20`) maps each kind to its binary name and a one-line install hint, surfaced by the startup pre-flight.

### Event normalization

Each adapter has a paired normalize module (`apps/bridge-cli/src/normalize/*.ts`) that maps its agent's raw output onto the unified `NormalizedEvent` union (`normalize/types.ts:76`):

| Event kind | Purpose |
|------------|---------|
| `message` | A chat turn (user or assistant), with optional `thinking` flag |
| `tool` | A tool invocation: `started` → `completed`/`failed`, with `input`/`output` |
| `file` | A file created/modified/deleted by the agent |
| `output` | Streaming text (assistant response or reasoning delta) |
| `status` | Lifecycle/progress: `session_ready`, `turn_usage`, `usage_update`, `session_list`, `status_snapshot`, `agent_exited`, `plan`, … |
| `error` | A recoverable-or-not error from the agent or transport |
| `approval` | A server-initiated request for the user to approve/deny an action |

Downstream consumers (relay-client, the server, the web UI) only ever understand these seven shapes — never any agent-specific protocol. For example, `normalizeClaudeCode` (`normalize/claude-code.ts:182`) switches on `raw.type` (`system`/`assistant`/`user`/`result`/`stream_event`) and maps each to normalized events; `normalizeOpencode` maps ACP `session/update` notifications; `normalizePi` parses pi's JSON-RPC lines.

### Bridge relay

The `RelayStore` (`packages/agent/src/bridge/relay-store.ts:19`) is the live data layer with two channels per session: `events↑` (agent → web) and `commands↓` (web → agent). It provides `append` (assigns a monotonic id, persists to the rolling window, notifies subscribers), `read` (replays events with id > afterId), and `subscribe` (live push).

- **In-memory** (`createInMemoryRelayStore`, `relay-store.ts:52`) — for dev/tests. A `Map<string, RelayChannelState>` with a `MAX_WINDOW=500` event ring buffer.
- **Redis** (`createRedisRelayStore`, `apps/server/src/redis-relay-store.ts:162`) — for production. Uses `INCR` for id allocation, `RPUSH` + `LTRIM` for the rolling window, `EXPIRE` for TTL (`WINDOW_TTL_SEC=900` for the list, `SEQ_TTL_SEC=86400` for the counter — the counter must never reset while a session is alive or post-reset events would be silently dropped as "already seen"), and `PUBLISH`/`SUBSCRIBE` for live push. A shared subscriber connection routes messages by channel.

`pushEvents` (`bridge.ts:158`) appends to the relay store (sequential ids) and best-effort persists to `bridge_messages` via `appendMany` — a persist failure is logged and swallowed since it must never break the live relay. `pollCommands` (`bridge.ts:185`) reads the `commands↓` channel and doubles as a liveness heartbeat (`bridgeSession.touch`). The web reads `events↑` via `observe` (poll) or the SSE stream.

`observeBridgeEvents` (`packages/api/src/bridge/stream.ts:23`) subscribes **before** reading to guarantee no event is missed: live events arriving during the replay read are buffered, then flushed in arrival order after the replay completes, deduped by id via a `seen` Set.

The web's SSE client (`apps/web/src/components/bridge/sse-client.ts`) uses `fetch` (not `EventSource`, which can't attach the bearer header) to read the `/bridge/sessions/:id/stream` route, pumping the body through `createSseParser`. It retries once on 401 after a token refresh, mirroring the oRPC link's interceptor since this fetch bypasses that link.

### Bridge terminal (web UI)

The `Terminal` component (`apps/web/src/components/bridge/terminal.tsx:228`) is the live view of one bridge session. It composes:

- **`TerminalHeader`** (`terminal-header.tsx:181`) — the prominent session id, connection status (`TerminalStatus`), capability summary (`SessionStatusHeader` from `session_ready`), and action cluster: session picker, Settings dialog, Past conversations, End button — each gated on `caps` (capability matrix).
- **`TerminalFeed`** (`terminal-feed.tsx:74`) — the auto-scrolling conversation surface. `foldEventsToTurns` (`bridge-turns.ts:262`) folds the raw event stream into renderable `BridgeTurn`s (user/assistant/status/task/plan/file/error/approval). The `WorkingSkeleton` shimmer shows during an in-flight turn; `deriveTurnInFlight` (`terminal.tsx:162`) scans tail-first so it never gets stuck (independent of turn-completion events, which opencode/pi/codex never emit).
- **`TerminalComposer`** (`terminal-composer.tsx:219`) — the input box with capability-gated control menus (model picker, permission mode), a `/`-picker for slash commands/skills, and Send/Stop (Stop replaces Send when a turn is interruptibly in flight).

`useBridgeTerminal` (`use-bridge-terminal.ts`) wires the transport: seeds from `history`, connects the SSE stream, merges live events with dedupe, exposes `sendInput`, `answerApproval`, `setModel`, `setPermissionMode`, `interrupt`, `listSessions`, `getStatus`, and derives `sessionReady`/`turnUsage`/`usageUpdate`/`sessionList` from the latest status events on the feed.

Live usage chips: `TurnUsagePanel` + `UsageUpdateLine` render only when `caps.usageMode === "stream"` (claude/opencode stream `turn_usage`/`usage_update`; pi polls via `getStatus`; codex has none).

### Bridge session management

- **Session picker** (`local-agent-session-picker.tsx:124`) — a dropdown listing this token's sessions (newest first) with short id, start time, and live/idle/ended status. `useSessionSelection` (`local-agent-session-picker.tsx:46`) defaults to following the most recent session until the user explicitly picks one.
- **Past conversations** (`past-conversations.tsx`) — gated on `caps.sessionList`; calls `listSessions` control which pushes a `session_list` status event (only claude-code's adapter implements this currently).
- **End session** (`terminal-header.tsx:152`) — the power button calls `bridge.endSession`, which flips the DB status to `ended` and best-effort appends a `control: stop` command to the `commands↓` channel so the CLI's poll loop tells the local agent to stop.
- **Settings dialog** (`local-agent-settings-dialog.tsx:134`) — edits the token's persisted `config` (appendSystemPrompt, effort, maxTurns, maxBudgetUsd), which the CLI fetches at `startSession` and applies at launch (currently claude-code). Also shows assigned memories (Memories tab).

## Key Files

| File | Responsibility |
|------|----------------|
| `apps/bridge-cli/src/index.ts` | CLI entry: parseArgs → selectAdapter → requireAgentCli → runBridgeSession |
| `apps/bridge-cli/src/args.ts` | `parseArgs`: `--agent`/`--token`/`--server`/`--dir`/`--label`/`--resume`/`--opencode-transport`/`--debug`, env fallbacks |
| `apps/bridge-cli/install.sh` | Standalone binary installer (Bun --compile, GitHub Releases, PATH hint) |
| `apps/bridge-cli/src/adapters/index.ts` | `selectAdapter`, `AGENT_CLI` (binary + install hint per kind) |
| `apps/bridge-cli/src/adapters/types.ts` | `Adapter`, `AgentHandle`, `AgentCapabilities`, `StatusSnapshotDetail`, `AgentStartConfig` |
| `apps/bridge-cli/src/adapters/claude-code.ts` | Claude Agent SDK adapter: `query()`, `canUseTool` approvals, `listSessions`, `getStatus` |
| `apps/bridge-cli/src/adapters/opencode.ts` | ACP adapter: `opencode acp` JSON-RPC, session/update, request_permission |
| `apps/bridge-cli/src/adapters/opencode-serve.ts` | `opencode serve` HTTP+SSE adapter (opt-in, unverified) |
| `apps/bridge-cli/src/adapters/codex.ts` | `codex app-server` JSON-RPC adapter: thread/start, turn/start, turn/interrupt |
| `apps/bridge-cli/src/adapters/pi.ts` | `pi --mode rpc` adapter: session_ready from 3 RPCs, getStatus poll |
| `apps/bridge-cli/src/adapters/process-io.ts` | `findOnPath`, `spawnProcessIo`: stdio plumbing, ENOENT handling |
| `apps/bridge-cli/src/normalize/types.ts` | `NormalizedEvent` union (7 kinds), `userMessageEvent` |
| `apps/bridge-cli/src/normalize/claude-code.ts` | `normalizeClaudeCode`: stream-json → normalized events |
| `apps/bridge-cli/src/normalize/opencode.ts` | `normalizeOpencode`: ACP session/update → normalized |
| `apps/bridge-cli/src/normalize/codex.ts` | `normalizeCodex`: app-server notifications → normalized |
| `apps/bridge-cli/src/normalize/pi.ts` | `normalizePi`: pi RPC lines → normalized |
| `apps/bridge-cli/src/relay-client.ts` | `forwardEvents` (batched push + retry queue), `runBridgeSession` (push + poll concurrent) |
| `apps/bridge-cli/src/relay-transport.ts` | `createRelayTransport`: oRPC client over fetch with `bt_` bearer |
| `apps/bridge-cli/src/poll-loop.ts` | `pollLoop`: pollCommands with backoff, `control: stop` handling |
| `apps/bridge-cli/src/commands.ts` | `parseCommandText`, `dispatchCommands`: text/approval/control routing |
| `packages/api/src/routers/bridge.ts` | `bridgeRouter`: token CRUD, startSession, pushEvents, pollCommands, observe, history, sendInput, endSession |
| `packages/agent/src/bridge/relay-store.ts` | `RelayStore` interface, `createInMemoryRelayStore`, `MAX_WINDOW`, `WINDOW_TTL_SEC` |
| `apps/server/src/redis-relay-store.ts` | `createRedisRelayStore`: INCR/RPUSH/LTRIM/PUBLISH, `SEQ_TTL_SEC=86400` |
| `packages/api/src/bridge/stream.ts` | `observeBridgeEvents` (subscribe→read→dedupe), `resolveStreamAuth`, SSE route |
| `apps/web/src/components/bridge/terminal.tsx` | `Terminal`: header + feed + composer, `useTerminalView`, `deriveTurnInFlight` |
| `apps/web/src/components/bridge/terminal-header.tsx` | Session id, status, picker, Settings, Past conversations, End button |
| `apps/web/src/components/bridge/terminal-feed.tsx` | Auto-scrolling feed, `WorkingSkeleton`, empty state |
| `apps/web/src/components/bridge/terminal-composer.tsx` | Input box, model/permission menus, `/`-picker, Send/Stop |
| `apps/web/src/components/bridge/bridge-turns.ts` | `foldEventsToTurns`: raw events → renderable turns |
| `apps/web/src/components/bridge/bridge-session-status.ts` | `SessionReadyDetail`, `TurnUsageDetail`, `UsageUpdateDetail` parsing |
| `apps/web/src/components/bridge/agent-capabilities.ts` | `capabilities(kind)`: per-agent-kind capability matrix |
| `apps/web/src/components/bridge/bridge-transport.ts` | `BridgeTransport`: SSE connect, history, observe, sendInput |
| `apps/web/src/components/bridge/sse-client.ts` | `connectBridgeStream`: fetch-based SSE, 401 refresh retry |
| `apps/web/src/components/bridge/local-agent-session-picker.tsx` | Session dropdown, `useSessionSelection` |
| `apps/web/src/components/bridge/local-agent-settings-dialog.tsx` | Settings modal: General/Config/Memories tabs |

## Data Flow

### Session start (CLI → server → agent)

```
better-agent-bridge --agent claude-code --token bt_… --server https://…
  → parseArgs → selectAdapter → requireAgentCli (PATH check)
  → createRelayTransport(serverUrl, token)
  → transport.startSession({agentKind, label})
    → bridge.startSession (bridgeProcedure, bt_ auth)
    → creates bridge_sessions row, returns { sessionId, config }
  → adapter.start(dir, { resume, config })
    → claude: query({ pathToClaudeCodeExecutable: findOnPath("claude"), … })
    → opencode: connectJsonRpc → initialize → session/new
    → codex: connectJsonRpc → initialize → thread/start
    → pi: spawnProcessIo → writeLine(get_state/get_available_models/get_commands)
  → runBridgeSession (push + poll loops concurrent)
```

### Event flow (agent → web)

```
Agent emits raw output
  → adapter normalizes → NormalizedEvent pushed to events queue
  → forwardEvents: batch (maxBatchSize=25, flushIntervalMs=250ms)
    → PushQueue (retry with backoff, maxBufferedEvents=1000)
    → transport.pushEvents({ sessionId, events })
      → bridge.pushEvents (bridgeProcedure)
        → requireOwnedBridgeSession
        → appendPushedEvents: relayStore.append (sequential ids) + size limit
        → persistEventsBestEffort: bridgeMessage.appendMany (best-effort)
        → bridgeSession.touch
Web:
  → history (seed on load, afterSeq=0)
  → connectBridgeStream (SSE, afterId=maxSeenId)
    → observeBridgeEvents: subscribe → read(afterId) → dedupe by id
    → onEvent → mergeEvents → foldEventsToTurns → BridgeChatRow
```

### Command flow (web → agent)

```
Web: user types → bridge.sendInput({ sessionId, data: text })
  → relayStore.append(sessionId, "commands", data)
CLI pollLoop: pollCommands({ sessionId, afterId })
  → relayStore.read(sessionId, "commands", afterId)
  → dispatchCommands:
    → text → sink.send(text) → adapter.send → agent input
    → approval → sink.answerApproval(requestId, optionId)
    → control: stop → pushStoppedByServerStatus + return (loop ends)
    → control: interrupt → sink.interrupt → session.interrupt()
    → control: setModel → sink.setModel → session.setModel()
    → control: setPermissionMode → sink.setPermissionMode
    → control: listSessions → sink.listSessions → pushes session_list event
    → control: getStatus → sink.getStatus → pushes status_snapshot event
  → afterIdRef advances past every command (dispatched or not)
```

### Session end

```
Web: End button → bridge.endSession({ sessionId })
  → bridgeSession.end (DB status → "ended")
  → best-effort relayStore.append("commands", { type:"control", action:"stop" })
CLI pollLoop: receives control:stop
  → pushStoppedByServerStatus (status event to events↑)
  → loop returns → handle.stop() (in runBridgeSession's finally)
  → process exits
```

## Design Rationale

- **Standalone binary (Bun --compile)** — the CLI embeds the runtime, so users don't need Node.js. It bundles no agent CLI, so `requireAgentCli`'s pre-flight catches a missing `claude`/`opencode`/`codex`/`pi` before a confusing mid-session spawn error.
- **Unified event model** — seven `NormalizedEvent` shapes mean the relay, server, and web never understand agent-specific protocols. Adding a new agent is one adapter + one normalize module.
- **`pathToClaudeCodeExecutable`** — the compiled binary drops the SDK's bundled claude, so the adapter points the SDK at the user's PATH `claude` via `findOnPath("claude")`.
- **Subscribe-before-read** — `observeBridgeEvents` subscribes to the live channel before reading the replay buffer, guaranteeing no event is missed. Live events during replay are buffered and flushed after, deduped by id.
- **Best-effort persistence** — `pushEvents` persists to `bridge_messages` but swallows failures; the live relay (in-memory/Redis) is authoritative for the live feed, and `history` seeds the web on reload.
- **Sequential relay ids, non-sequential DB seq** — relay appends are sequential (each assigns the next id off the previous); Postgres persistence isn't, so it's batched separately. The web dedupes by relay id, and `history`'s seq shares the same numbering so replayed-then-live events merge cleanly.
- **Capability matrix, not agent checks** — `capabilities(kind)` returns a static per-kind matrix; every optional UI surface (picker, Past conversations, usage chip, interrupt button) is gated on it. No `if (agentKind === "claude")` in the UI.
- **`deriveTurnInFlight` tail-scan** — the "working" skeleton is derived from the last renderable event, not a turn-completion event (which opencode/pi/codex never emit). This prevents the skeleton from getting stuck on forever.
- **Redis seq TTL >> window TTL** — the counter key has a 24h TTL (vs 15min for the list) because consumers hold a persistent high-water mark; if `INCR` ever reset, every post-reset event would be silently dropped as "already seen".
- **Deduplicated refresh on SSE** — the SSE client bypasses the oRPC link, so it re-implements the 401→refresh→retry once pattern (`openStream` in `sse-client.ts`).
- **Control commands vs text** — `control: stop` / `interrupt` / `setModel` etc. are structured records, not text, so the CLI can tell "stop the agent" apart from "send it this text".
- **Idle backoff ceiling** — pollLoop backs off to 2s (not 5s+) while idle so the first command a user types takes at most ~2s to be picked up; the bridge is interactive, not a batch poller.

## Configuration

| Knob | Location | Default | Notes |
|------|----------|---------|-------|
| Agent kinds | `adapters/types.ts:5` | `claude-code, opencode, codex, pi` | mirrored in `bridge.ts:19` `AGENT_KINDS` |
| Opencode transport | `args.ts:74` | `acp` | `--opencode-transport serve` opts into HTTP+SSE |
| Relay rolling window | `relay-store.ts:15` `MAX_WINDOW` | 500 | events retained per (session, dir) for replay |
| Relay window TTL | `relay-store.ts:17` `WINDOW_TTL_SEC` | 900 (15min) | Redis list TTL |
| Relay seq TTL | `redis-relay-store.ts:21` `SEQ_TTL_SEC` | 86400 (24h) | counter key TTL — must never reset while session alive |
| Push batch size | `relay-client.ts:30` | 25 | `DEFAULT_MAX_BATCH_SIZE` |
| Push flush interval | `relay-client.ts:31` | 250ms | `DEFAULT_FLUSH_INTERVAL_MS` |
| Push retry buffer | `relay-client.ts:36` | 1000 | `DEFAULT_MAX_BUFFERED_EVENTS` |
| Poll min interval | `poll-loop.ts:13` | 500ms | `DEFAULT_MIN_INTERVAL_MS` |
| Poll max interval | `poll-loop.ts:17` | 2000ms | `DEFAULT_MAX_INTERVAL_MS` (idle backoff ceiling) |
| Poll backoff factor | `poll-loop.ts:18` | 2 | `BACKOFF_FACTOR` |
| Max push batch (server) | `bridge.ts:21` `MAX_PUSH_BATCH` | 50 | events per `pushEvents` call |
| History default limit | `bridge.ts:28` | 500 | `DEFAULT_HISTORY_LIMIT` |
| History max limit | `bridge.ts:30` | 500 | `MAX_HISTORY_LIMIT` |
| Agent CLI install hints | `adapters/index.ts:20` `AGENT_CLI` | per-kind | `claude`: `npm i -g @anthropic-ai/claude-code`; `opencode`: `curl -fsSL https://opencode.ai/install \| bash`; `codex`: `npm i -g @openai/codex`; `pi`: see GitHub |
| Install dir | `install.sh:16` | `~/.better-agent/bin` | override with `INSTALL_DIR` |
| Claude permission modes | `adapters/claude-code.ts:39` | `default, acceptEdits, bypassPermissions, plan, dontAsk, auto` | `PERMISSION_MODES` set |
| Opencode permission modes | `agent-capabilities.ts:76` | `build, plan` | `OPENCODE_PERMISSION_MODES` |
| Bridge token prefix | `bridge.ts:17` | `bt_` | `TOKEN_PREFIX` |
| Env fallbacks | `args.ts:110-115` | `BETTER_AGENT_BRIDGE_TOKEN`, `BETTER_AGENT_BRIDGE_SERVER` | token/server don't need to be typed every run |

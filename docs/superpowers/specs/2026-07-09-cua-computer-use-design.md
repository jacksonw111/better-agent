# Cua Computer-Use Integration — Design Spec

**Date:** 2026-07-09
**Status:** Design approved through iterative discussion. Key decisions locked:
VNC-first (human viewing), **ax-only** computer-use (no vision, no screenshots to the model),
cloud agent is the driver, `apps/server` runs on Docker (Redis available).

## Goal

Let a **cloud agent** drive a **local VM** on the user's machine for computer-use tasks, and let the
user **watch the desktop live over VNC**. The local CLI (bridge-cli) already connects out to the
cloud and is controlled over a relay; this feature makes the cloud "start a VM and operate it,"
reusing that channel plus the existing remote-tool park/resolve primitive.

## Locked decisions (why the design is small)

- **ax-only perception.** Cua supports three perception modes — `ax` (accessibility tree, text,
  click by `element_index`, no screenshot), `vision` (screenshot + coordinates), `som` (both,
  default). We use **`ax` only** for now. Consequence: every computer-use tool result is **plain
  text** (a Markdown outline of actionable nodes) → fits the existing `ExecuteResult { output:
  string }` with **no multimodal work and no screenshots crossing to the model**. `vision` is a
  future toggle.
- **VNC is for the human, not the model.** The agent perceives via the `ax` tree; the VNC stream is
  a separate plane so the user can watch. These never mix.
- **Cloud-brain.** The cloud agent (our LLM) calls computer-use tools; execution happens on the
  local VM. (Cua's own local agent loop = "local-brain" — not this design.)
- **`apps/server` is on Docker**, so `REDIS_URL` is present: park/resolve and a long-lived VNC
  WebSocket proxy both work. The "client-tools-need-Redis-on-Workers" caveat only bites if server
  moves to Workers (note: `buildRelayStore` has no Upstash branch yet — a Workers-only gap).

## Three data planes (the core idea)

Nothing is monolithic; three independent planes, each reusing existing machinery where possible:

1. **Control plane** — relay `commands↓` / `events↑` (existing). VM lifecycle: `startVm` / `stopVm`
   / `listVms` as new control actions. Small JSON.
2. **Tool plane** — the existing **remote-tool park/resolve** primitive
   (`buildRemoteToolDefs` + `PendingToolCallStore` + `submitToolResult`). The cloud agent's
   computer-use tools park; the local CLI executes against the VM and resolves. All results are
   `ax`-tree / status **text**.
3. **Video plane (VNC)** — a NEW WebSocket proxy on the Docker server. `browser noVNC ⇄ server WS
   proxy ⇄ CLI outbound WS ⇄ VM localhost VNC`. RFB bytes, **never** the relay (its 500-item/900s
   JSON window can't carry video). The VM's VNC binds localhost only; reached solely via the CLI's
   outbound connection — never internet-exposed.

## Reuse map (what already exists — do NOT rebuild)

| Existing | File | Role in this feature |
|---|---|---|
| Relay `commands`/`events` + `RelayStore` | `packages/agent/src/bridge/relay-store.ts`, `apps/server/src/redis-relay-store.ts` | control plane transport |
| `CommandSink` → adapter dispatch | `apps/bridge-cli/src/commands.ts` | add `startVm`/`stopVm` control actions |
| Remote-tool park/resolve | `packages/agent/src/tool/remote-tools.ts`, `pending-store.ts`; `sessions.submitToolResult` | tool plane — computer-use tools park here |
| `ToolDef` / `buildTools` / `runTurn` | `packages/agent/src/tool/*`, `session/runtime.ts` | text tool results already handled (caps just raised to 128KiB / 200 steps) |
| Tool injection per agent | `packages/api/src/routers/agent-tool-defs.ts` (`assembleAgentToolDefs`) | inject computer-use tools when a cua session is linked |
| Bridge session + capability | `packages/db/src/schema/bridge.ts`, `apps/web/src/components/bridge/agent-capabilities.ts` | represents the live local session; add a `cua`/`vnc` capability |
| Adapter interface | `apps/bridge-cli/src/adapters/types.ts` | a cua execution handler slots in |

## New pieces

### Local (bridge-cli)
- **lume client** — wrap lume's HTTP API (`lume serve`, `POST /lume/vms/:name/run`, `lume stop`,
  `GET /lume/vms`). Started/health-checked by the CLI.
- **cua execution handler** — connects to each VM's computer-server via `@trycua/computer` (TS SDK).
  Implements the computer-use actions in `ax` mode: `observe` (get accessibility tree),
  `click_element(index)`, `type(text)`, `scroll`, `key`. Unlike the coding adapters, it is
  **driven by the cloud agent**, not an autonomous local model.
- **new control actions** — `startVm` / `stopVm` / `listVms` parsed in `commands.ts`, dispatched to
  the lume client; VM status pushed up via `events`.
- **VNC bridge** — an outbound WS from the CLI to the server that pipes RFB bytes to/from the VM's
  localhost VNC port.

### Cloud
- **computer-use ToolDefs** — built via `buildRemoteToolDefs` (park on `PendingToolCallStore`),
  results resolved by the CLI's `submitToolResult`. Text-only (`ax`). Injected in
  `assembleAgentToolDefs` when the agent is linked to a live cua session.
- **agent ↔ cua-session link** — a routing key so a turn's computer-use tool calls resolve against
  the right local session (baked into the ToolDef closure at assembly time, mirroring how composio
  account resolvers bake in their account).
- **VNC WS proxy** — a server endpoint pairing the browser's noVNC WS with the CLI's outbound WS,
  owner-scoped (`requireOwnedBridgeSession`), `wss` + VNC password.

### Web
- **VNC viewer** — noVNC component on the Local Agent detail page, mounted when the `cua`/`vnc`
  capability is set; shows the live desktop.
- **Start/Stop VM controls** + VM status.

## Constants already changed (prep, committed separately)

- `MAX_OUTPUT_BYTES` 50 KiB → **128 KiB**, `MAX_OUTPUT_LINES` 2000 → **4000**
  (`packages/agent/src/tool/truncate.ts`) — `ax` trees survive without truncation.
- `DEFAULT_MAX_STEPS` 50 → **200** (`packages/agent/src/session/runtime.ts`) — observe→act loops
  (opencode leaves this effectively unbounded; 200 is a bounded backstop).

## Breaking changes

**None on the cloud agent — all additive.** ax-only makes tool results plain strings the existing
turn loop already handles. New control actions are additive union members; the capability flag is an
additive field (coordinate the edit — the concurrent remote-control work is changing
`AgentCapabilities`). No DB enum change if we avoid a new `AgentKind` (use a capability + execution
handler instead). Possible additive nullable column `bridge_sessions.vncEndpoint` (or push via
event).

## Security

- CLI is outbound-only; VM VNC/computer-server bind localhost → **VM never internet-exposed**.
- Agent drives a **sandbox VM (lume-isolated), not the host** — the key blast-radius boundary.
- Computer-use actions gated by the existing **approval** mechanism for destructive steps.
- VNC proxy WS + `submitToolResult` owner/session-scoped; `wss` + VNC password.
- `bt_` bridge token is revocable (`deleteToken`).

## Performance

- VNC via cloud proxy = double hop (browser→cloud→local) → fine to **watch**, laggy to hand-drive;
  WebRTC is the future low-latency path (out of scope now).
- Tool plane uses **streaming tool-calls + `submitToolResult`** (fast), NOT the relay poll loop
  (500ms–2s backoff). Each ax action = one cloud↔local round-trip + VM action (sub-second).
- `PENDING_TTL_MS = 120_000` is ample per ax action (they're fast) — no change needed.

## Phasing

- **Phase 1 (this plan):** lume VM lifecycle (start/stop over control plane) + VNC viewing (WS proxy
  + noVNC) — "cloud starts a VM, human watches."
- **Phase 2:** ax computer-use tools (observe/click/type via park/resolve) — "cloud operates the VM."
- **Phase 3 (future):** `vision` mode; WebRTC low-latency streaming.

## Non-goals (now)

- `vision` / screenshots to the model; multimodal tool results.
- WebRTC (VNC first).
- Cua's local-brain agent loop.
- A new `AgentKind` in the DB enum (use a capability + handler).

## Coordination risk

The bridge-cli adapters, `bridge.ts`, `commands.ts`, `AgentCapabilities`, and `runtime.ts` are the
**active working area of the concurrent remote-control session**. This feature extends exactly that
infrastructure. Implementation must be sequenced to avoid editing those files while that session is
mid-flight (see the plan's execution note).

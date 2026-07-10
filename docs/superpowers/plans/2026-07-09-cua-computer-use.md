# Cua Computer-Use Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Spec: `docs/superpowers/specs/2026-07-09-cua-computer-use-design.md`.

**Goal:** Cloud agent starts + operates a local Cua VM (ax-only) and the user watches over VNC,
reusing the relay control plane + remote-tool park/resolve + adding a VNC WS proxy.

## Global Constraints

- **ax-only**: every computer-use tool result is text; no screenshots to the model, no multimodal.
- Reuse: relay `commands`/`events`, `buildRemoteToolDefs`+`PendingToolCallStore`+`submitToolResult`,
  `ToolDef`/`runTurn`, bridge session + capability, `Adapter` interface. Do NOT rebuild these.
- No new `AgentKind` in the DB enum — use a capability flag + a cua execution handler.
- Biome/ultracite + ESLint clean (complexity 10, ≤50 lines/fn, ≤299 lines/file). Stage only your
  files; never `git add -A`. `apps/server` is on Docker (Redis present).
- Tool-output caps already raised (128 KiB/4000) and `DEFAULT_MAX_STEPS`=200 (committed separately).

## ⚠️ Execution sequencing (concurrent-session hazard)

The concurrent **remote-control** session is actively editing (and mid-git-rebase on)
`apps/bridge-cli/src/commands.ts`, the adapters, `packages/api/src/routers/bridge.ts`,
`apps/web/.../agent-capabilities.ts`, and `runtime.ts`. Building into those files now = conflicts.

- **Lane A (independent — new files, build now / concurrently):** Tasks A1–A5. Minimal edits to
  hot files.
- **Lane B (hot-file edits — run only after the remote-control feature lands or that session is
  idle):** Tasks B1–B4. These extend the command protocol + capability + injection points.

Dispatch Lane A concurrently (worktree-isolated per task). Gate Lane B on a clean bridge tree.

---

## Lane A — independent (new files)

### Task A1: `@trycua/computer` + lume HTTP client
**Files:** `apps/bridge-cli/package.json` (add `@trycua/computer`); create
`apps/bridge-cli/src/cua/lume-client.ts` + `.test.ts`.
- `createLumeClient({ baseUrl = "http://localhost:7777", fetchImpl? })` with:
  `run(name)` → `POST /lume/vms/:name/run` (202); `stop(name)` → `POST /lume/vms/:name/stop` (or CLI
  `lume stop`); `list()` → `GET /lume/vms`; `get(name)` → status incl. VNC/ip. Degrade + typed
  errors; inject `fetchImpl` for tests. Test with a fake fetch (fixtures for run/list/status).

### Task A2: cua execution handler (ax actions via `@trycua/computer`)
**Files:** create `apps/bridge-cli/src/cua/cua-handler.ts` + `.test.ts`.
- `createCuaHandler({ computer })` exposing ax actions: `observe()` → accessibility tree text,
  `clickElement(index)`, `type(text)`, `scroll(dir, amount)`, `key(combo)`. Each returns a text
  result string. Uses the `@trycua/computer` `Computer` client in `ax` mode. No screenshots.
  Unit-test the action→SDK-call mapping with a fake `Computer`.

### Task A3: computer-use ToolDefs (cloud side)
**Files:** create `packages/agent/src/tool/computer-use-tools.ts` + `.test.ts`.
- `buildComputerUseToolDefs(store: PendingToolCallStore, sessionId): ToolDef[]` returning
  `observe`, `click_element` (`{index}`), `type_text` (`{text}`), `scroll` (`{dir,amount}`),
  `press_key` (`{combo}`) — each `execute` = `store.park({ sessionId, callId, abortSignal })`
  (mirror `buildRemoteToolDefs`). Parameters are JSON Schema. Text results only. Test: each def
  parks and resolves to the injected result.

### Task A4: VNC WebSocket proxy (server)
**Files:** create `apps/server/src/vnc-proxy.ts` + `.test.ts`; register route in the server's WS
setup.
- A WS endpoint `/bridge/:sessionId/vnc` (owner-scoped) that pairs the browser noVNC socket with the
  CLI's outbound VNC socket for that session, piping RFB bytes both ways. Pairing keyed by
  sessionId; requires the CLI to have registered its VNC socket. Test the pairing/pipe logic with
  in-memory fake sockets. (Docker server → long-lived WS OK.)

### Task A5: noVNC web viewer + DB column
**Files:** add `@novnc/novnc` to `apps/web`; create
`apps/web/src/components/bridge/vnc-viewer.tsx`; migration for nullable
`bridge_sessions.vnc_endpoint` (`packages/db` — `db:generate`).
- `VncViewer({ sessionId })` opens a WS to the server VNC-proxy route and renders the RFB canvas.
  Mounted later (Lane B) behind the capability. DB column via drizzle generate.

---

## Lane B — hot-file edits (gate on a clean bridge tree)

### Task B1: VM-lifecycle control actions (bridge-cli)
**Files:** edit `apps/bridge-cli/src/commands.ts` (+ `CommandSink`), `adapters/types.ts`
(`AgentHandle`), wire to the lume client (A1).
- Add `ControlStartVmCommand {action:"startVm", image, name, cpu?, memory?}`, `ControlStopVmCommand`,
  `ControlListVmsCommand`; parse + dispatch to new `CommandSink.startVm/stopVm/listVms`. Push VM
  status via `events`. Mirror the existing control-action pattern exactly.

### Task B2: capability flag
**Files:** edit `apps/web/src/components/bridge/agent-capabilities.ts` + the mirror in
`apps/bridge-cli/src/adapters/types.ts`.
- Add `cua: boolean` (and/or `vnc: boolean`) to `AgentCapabilities` + all matrix entries.
  **Coordinate with the remote-control session's concurrent edits to this file.**

### Task B3: computer-use tool injection + agent↔cua-session link
**Files:** edit `packages/api/src/routers/agent-tool-defs.ts`; add the link (agent → bridge
session) plumbing.
- In `assembleAgentToolDefs`, when the agent is linked to a live cua session, inject
  `buildComputerUseToolDefs(pendingStore, bridgeSessionId)` (A3). Define how a turn maps to a bridge
  session (routing key baked into the closure). Ensure `submitToolResult` from the CLI resolves it.

### Task B4: VNC proxy wiring + web viewer mount + Start/Stop UI
**Files:** edit `packages/api/src/routers/bridge.ts` (VNC endpoint registration if needed), the
Local Agent detail page/components; mount `VncViewer` (A5) behind the capability (B2); add Start/Stop
VM buttons that send the B1 control actions; CLI opens its outbound VNC socket on `startVm`.

---

## Tests / verification

- Per task: unit tests as noted; `pnpm -F <pkg> test` + check-types + ultracite.
- Integration smoke (manual, after B): CLI locally → web "Start VM" → lume boots → VNC viewer shows
  desktop → agent turn calls `observe`/`click_element` → resolves. (No auto browser testing — user
  verifies the UI.)

## Self-review notes

- ax-only ⇒ no `ExecuteResult` change, no multimodal. Confirm computer-use tool results are strings.
- Park/resolve TTL (2 min) ample for ax actions; do not change.
- Capability flag touches the concurrent session's file — B2 is the coordination-critical edit.

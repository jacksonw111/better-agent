# CUA Remote Control — Phase 1 Testing Guide

**Status:** Phase 1 (the *video plane* — cloud starts a VM, human watches over
VNC) is **code-complete and unit-tested, but has never been run end-to-end** —
no macOS/Apple-Silicon + lume environment was available during development.
Expect rough edges on the first real run; the `[cua]` logs (with `--debug`) are
the place to diagnose them.

Phase 2 (the *tool plane* — the cloud agent actually operating the desktop:
observe / click / type) is **not started**. See
`docs/superpowers/specs/2026-07-09-cua-computer-use-design.md`.

---

## What Phase 1 does

`agent-cli --cua`, alongside the normal agent session:

1. **Auto-provisions prerequisites** (no manual setup): installs `lume` if
   missing, starts `lume serve`, and pulls the VM image if absent. macOS /
   Apple Silicon only.
2. **Boots a local VM** and, once it exposes a VNC endpoint, opens a **VNC
   relay**: the VM's localhost VNC (TCP) ⇄ the server's
   `/bridge/vnc/agent/:sessionId` over an outbound bearer-authed WebSocket.
3. **Reports the VNC endpoint** so the web mounts the viewer.
4. In the web **Local Agent** detail page, a **Remote Desktop** panel appears
   with the live desktop and **Start desktop / Stop desktop** buttons.

Data flow: `browser noVNC ⇄ server VNC proxy ⇄ CLI relay ⇄ VM localhost VNC`.
The VM's VNC binds localhost only and is reached solely through the CLI's
outbound connection — never internet-exposed.

---

## Prerequisites

- A **Mac on Apple Silicon** (lume requirement).
- The agent CLI for your `--agent` kind installed on PATH (e.g. `claude` for
  `--agent claude-code`) — `--cua` runs *alongside* an agent session.
- A reachable **server** (the deployed test environment, or local dev) and a
  **bridge token**.

### ⚠️ You must build `agent-cli` yourself

The `--cua` support lives on the `dev` branch and is **not published to npm**.
The `agent-cli` you get from `npm i -g` does **not** have it.

**Recommended — a standalone binary** (single file, no Node needed on the target
machine; macOS/Apple Silicon):

```bash
cd better-agent
pnpm install
pnpm --filter @jacksonw111/better-agent-bridge compile   # needs `bun` installed
# → apps/bridge-cli/agent-cli   (a ~60MB Mach-O arm64 executable)
```

Copy `apps/bridge-cli/agent-cli` to wherever you'll test and run it directly:
`./agent-cli --agent … --cua-vnc-url …`. (Don't have bun? `curl -fsSL
https://bun.sh/install | bash`.)

Alternatively, `pnpm --filter @jacksonw111/better-agent-bridge build` produces
`apps/bridge-cli/dist/index.mjs`, run via `node …` (needs Node on the target).

### Get a bridge token

In the web app: **Local Agents → add a local agent** → copy the `bt_…` token
and note the server URL it shows.

---

## Full test (real VM)

```bash
./agent-cli \
  --agent claude-code \
  --server https://<your-server-url> \
  --token bt_xxxxxxxx \
  --dir ~/some/project \
  --cua --debug
```

**Already have lume + a VM image?** Point at your existing VM with
`--cua-vm <name>` — if that VM already exists nothing is pulled (the bootstrap
skips install/serve/pull for anything already present). `--cua-image <img:tag>`
overrides what's pulled only when the VM is absent.

What to expect:

- The normal agent session connects (visible in the web Local Agent view).
- `[cua]` logs walk through: lume check → (first time) install → `lume serve`
  → **pull VM image** → boot → `VNC relay up …`.
- In the web Local Agent detail page, the **Remote Desktop** panel shows the
  live VM once it has booted; use **Stop desktop / Start desktop** to control it.

> **The big cost:** the VM image (`macos-sequoia-cua:latest`) is **tens of GB**.
> The first `lume pull` is slow. lume install may prompt for permissions.

---

## Lighter test (no lume, no giant image) — **recommended first**

The whole video plane (CLI relay ⇄ server proxy ⇄ web viewer) is independent of
lume — lume only produces "a VM with a VNC". `--cua-vnc-url <host:port>` skips
lume/VM provisioning and relays **any** VNC directly, so you can validate ~90%
of Phase 1 in minutes:

1. Turn on macOS **Screen Sharing** (System Settings → General → Sharing →
   Screen Sharing) — it's a VNC server on `:5900`. (Set a VNC password under
   "Computer Settings…" if prompted; noVNC will ask for it.)
2. Run it (note: `--cua-vnc-url` implies `--cua`, no separate `--cua` needed):

   ```bash
   ./agent-cli \
     --agent claude-code \
     --server https://<your-server-url> \
     --token bt_xxxxxxxx \
     --dir ~/some/project \
     --cua-vnc-url localhost:5900 --debug
   ```

3. In the web Local Agent view, the Remote Desktop panel should show **your own
   Mac's screen**; Stop/Start desktop just drops/re-opens the relay (no VM).

This exercises the relay, server pairing/auth, the web viewer, and Start/Stop —
everything except lume itself. Once this works, the only unverified piece left
for the full run is lume + the VM image.

---

## Troubleshooting

- **`CUA requires macOS on Apple Silicon …`** — you're not on macOS/arm64. This
  path can't run elsewhere by design (lume runs Apple-Virtualization VMs).
- **`lume install failed` / `lume serve did not become reachable`** — run
  `lume serve` manually and check `http://localhost:7777/lume/vms`; re-run.
- **`VM did not expose a VNC endpoint in time`** — the VM booted but lume never
  reported a `vncUrl`; check `lume get <name>` output shape (the relay parses
  `vnc_url`/`vncUrl`). This is a likely first-run mismatch — capture the raw
  lume response.
- **`Unparseable VNC URL from lume: "…"`** — lume returned a VNC URL in a form
  `parseVncTarget` (apps/bridge-cli/src/cua/vnc-relay.ts) doesn't handle yet;
  send the exact string.
- **Web shows "Connecting…" forever** — the viewer reached the server proxy but
  no CLI producer is attached (VM not up yet, or the relay/auth failed). Check
  the `[cua]` logs for `VNC relay up`.
- **Nothing in the web** — confirm the same bridge token owns the session and
  the server URL matches; the Remote Desktop panel only appears once a
  `vncEndpoint` has been reported at least once.

---

## Where the code lives

- CLI: `apps/bridge-cli/src/cua/` — `lume-bootstrap.ts` (provisioning),
  `vnc-relay.ts` (RFB WS↔TCP bridge), `cua-session.ts` (glue),
  `cua-controller.ts` (Start/Stop lifecycle); wired in `index.ts` behind
  `--cua`; control commands in `commands-control.ts`.
- Server: `apps/server/src/vnc-proxy.ts` (the WS proxy pairing).
- Web: `apps/web/src/components/bridge/remote-desktop-panel.tsx` +
  `vnc-viewer.tsx`; also a bare test page at `/debug/remote`.
- Reporting: `bridge.reportVnc` (packages/api) + `vnc_endpoint` column.

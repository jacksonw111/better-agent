# @jacksonw111/better-agent-bridge

The bridge CLI for **Better Agent** — connects a local coding agent (`claude-code`, `opencode`, `codex`, or `pi`) running on your machine to a Better Agent server. The agent's events stream up to the server, and the web UI's chat input is forwarded back down, so you can drive a local agent from the browser.

As of 0.2.0 the CLI's canonical command is **`agent-cli`** (renamed from `better-agent-bridge`, which stays installed as an alias for one major version — existing scripts keep working unchanged).

```
your machine                                  better-agent server
┌───────────────────┐   events ↑ ↓ input    ┌──────────────────┐
│ claude/opencode/  │ ──────────────────── → │   server (API)   │
│ codex / pi        │                        │   web (chat UI)  │
└───────────────────┘        agent-cli       └──────────────────┘
```

## Install

### One-line install (recommended) — standalone binary, no Node/npm needed

```bash
curl -fsSL https://github.com/jacksonw111/better-agent/releases/latest/download/install.sh | bash
```

This downloads a self-contained binary for your platform (macOS/Linux, x64/arm64) and installs it to `~/.better-agent/bin`, then tells you how to add it to `PATH`:

```bash
export PATH="$HOME/.better-agent/bin:$PATH"   # add to ~/.zshrc or ~/.bashrc
agent-cli --version
```

### Alternative: npm (GitHub Packages)

Also published to [GitHub Packages](https://github.com/jacksonw111/better-agent/pkgs/npm/better-agent-bridge). GitHub Packages authenticates even public packages, so first add a PAT (needs only `read:packages`) to `~/.npmrc`:

```ini
@jacksonw111:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${BETTER_AGENT_PAT}
```

```bash
export BETTER_AGENT_PAT=ghp_xxx_read_packages   # or put the token inline above
npm install -g @jacksonw111/better-agent-bridge
```

This installs both the `agent-cli` and `better-agent-bridge` bin entries (same executable).

## Prerequisites

The chosen agent's CLI must be installed and on `PATH`:

| `--agent`    | binary needed              |
| ------------ | -------------------------- |
| `claude-code`| `claude` (Anthropic SDK)   |
| `opencode`   | `opencode`                 |
| `codex`      | `codex`                    |
| `pi`         | `pi`                       |

## Usage

```bash
agent-cli --agent <kind> --token <bt_…> --server <url> [options]
```

### Flags

| Flag       | Required | Description                                                                            |
| ---------- | -------- | -------------------------------------------------------------------------------------- |
| `--agent`  | yes      | One of `claude-code` \| `opencode` \| `codex` \| `pi`.                                 |
| `--token`  | yes*     | Bridge token (`bt_…`) from the Better Agent dashboard. Env: `BETTER_AGENT_BRIDGE_TOKEN`. |
| `--server` | yes*     | Better Agent server URL, e.g. `https://agent-api.trendf.top`. Env: `BETTER_AGENT_BRIDGE_SERVER`. |
| `--dir`    | no       | Working directory the agent runs in. Defaults to the current directory.                |
| `--label`  | no       | Optional label for this session (shown in the dashboard).                              |
| `--resume` | no       | Prior **claude-code** conversation id to resume (ignored by other agents).             |
| `--debug`  | no       | Verbose: log every event/command to stderr.                                            |

\* `--token` and `--server` may be provided via their env vars instead of the flags.

### Examples

Run claude-code in the current project:

```bash
agent-cli --agent claude-code \
  --token bt_xxx --server https://agent-api.trendf.top
```

Run opencode against a local dev server, using env vars for the token/server:

```bash
export BETTER_AGENT_BRIDGE_TOKEN=bt_xxx
export BETTER_AGENT_BRIDGE_SERVER=http://localhost:3000
agent-cli --agent opencode --dir ~/code/myproject
```

Resume a previous claude-code conversation:

```bash
agent-cli --agent claude-code --token bt_xxx \
  --server https://agent-api.trendf.top --resume 11c186d9-…
```

Once connected you'll see:

```
Starting claude-code in /path/to/project → https://agent-api.trendf.top
Connected. Session <id>. Drive it from the web Local Agent view;
input here is forwarded to the agent.
```

## How it works

1. Registers a session with the server (which returns the token's persisted startup config — system prompt, max turns, budget, etc.).
2. Spawns the local agent CLI in `--dir`, applying that config.
3. Relays the agent's normalized events up to the server and forwards the web UI's chat input down to the agent, until `SIGINT`/`SIGTERM` or the session ends.

## Development

```bash
pnpm install
pnpm -F @jacksonw111/better-agent-bridge build      # tsdown → dist/index.mjs
pnpm -F @jacksonw111/better-agent-bridge test
pnpm -F @jacksonw111/better-agent-bridge dev -- --agent claude-code --token bt_xxx --server http://localhost:3000   # tsx, no build needed
```

## Releasing

A new release is published automatically when a `cli-v*` tag is pushed (see `.github/workflows/release-cli.yml`): Bun `--compile` builds standalone binaries for macOS/Linux (x64 + arm64) and attaches them — plus `install.sh` — to a GitHub Release. It uses the built-in `GITHUB_TOKEN`, so no manual secret is required.

```bash
git tag cli-v0.1.0
git push origin cli-v0.1.0
```

Once the release workflow finishes, `install.sh` serves the new version from `releases/latest/download/` automatically.

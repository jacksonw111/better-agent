# 桥接 / 本地 Agent

桥接将用户本地安装的编码 agent（claude-code、opencode、codex 或 pi）连接到 better-agent web UI。一个独立的 CLI 二进制文件（`better-agent-bridge`）驱动本地 agent，将其输出归一化为统一的事件模型，并通过服务端滚动窗口存储中继事件↑ / 命令↓。Web 将实时数据流渲染为终端风格的聊天界面，并提供按能力门控的控件（模型选择器、中断、历史会话、用量芯片）。

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web（浏览器）                                              │
│    Terminal → useBridgeTerminal → BridgeTransport                │
│      connectStream: SSE /bridge/sessions/:id/stream              │
│      history: 持久化事件（加载时种子）                            │
│      sendInput: POST bridge.sendInput                            │
│    foldEventsToTurns → BridgeChatRow / WorkingSkeleton           │
│    capabilities(agentKind) 门控每个可选 UI 表面                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │  SSE（事件↑）+ oRPC（命令↓）
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/server                                                     │
│    bridgeRouter (oRPC): startSession, pushEvents, pollCommands,  │
│      observe, history, sendInput, endSession, usageByAgentKind   │
│    RelayStore: Redis（生产）/ 内存（开发）                        │
│      每会话 events↑ 通道 + commands↓ 通道                         │
│      滚动窗口 (MAX_WINDOW=500, WINDOW_TTL_SEC=900)               │
│    SSE 路由 /bridge/sessions/:id/stream                          │
│      observeBridgeEvents: 订阅 → read(afterId) → 去重             │
│    尽力持久化到 bridge_messages (appendMany)                      │
└──────────────────────┬──────────────────────────────────────────┘
                       │  基于 fetch 的 oRPC（Bearer bt_…）
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/bridge-cli（独立 Bun --compile 二进制）                     │
│    parseArgs → selectAdapter(kind) → requireAgentCli（PATH 检查）│
│    createRelayTransport(serverUrl, token)                        │
│    transport.startSession → { sessionId, config }                │
│    adapter.start(dir, {resume, config}) → AgentHandle            │
│    runBridgeSession:                                             │
│      forwardEvents: agent.events → 批量 pushEvents（重试队列）    │
│      pollLoop: pollCommands(afterId) → dispatchCommands → sink   │
│    SIGINT/SIGTERM → handle.stop()                                │
└──────────────────────┬──────────────────────────────────────────┘
                       │  SDK / JSON-RPC / stdio
                       ▼
              本地 agent 进程
              (claude, opencode, codex, pi)
```

### 桥接 CLI

`better-agent-bridge` 是用 `bun --compile` 编译的独立二进制文件（无需 Node.js）。`install.sh`（`apps/bridge-cli/install.sh`）从 GitHub Releases 下载平台资产到 `~/.better-agent/bin` 并打印 PATH 提示。它同时处理公共仓库（releases/latest/download 快捷方式）和私有仓库（通过 `GITHUB_TOKEN` 进行认证 API 资产解析）。

入口点（`apps/bridge-cli/src/index.ts:27` `main`）：

1. `parseArgs`（`args.ts:92`）— `--agent`、`--token`、`--server`、`--dir`，可选 `--label`、`--resume`、`--opencode-transport`、`--debug`。回退到 `BETTER_AGENT_BRIDGE_TOKEN` / `BETTER_AGENT_BRIDGE_SERVER` 环境变量和 `process.cwd()`。
2. `selectAdapter`（`adapters/index.ts:49`）— 为 agent 类型选择适配器；opencode 遵循 `--opencode-transport`（默认 `acp`，可选 `serve`）。
3. `requireAgentCli`（`index.ts:15`）— PATH 预检：`findOnPath(cli.binary)` 检查 agent 的 CLI 是否已安装。如果缺失，以精确的安装提示退出（如 `npm i -g @anthropic-ai/claude-code`）。独立二进制不捆绑任何 agent CLI。
4. `transport.startSession` 在 `adapter.start` **之前**注册会话，这样服务端能及时返回令牌持久化的启动 `config`（Phase 4），供适配器应用。
5. `runBridgeSession`（`relay-client.ts:183`）并发运行推送 + 轮询循环，直到 agent 退出或 `SIGINT`/`SIGTERM` 触发。`handle.stop()` 始终在 `finally` 中运行。

### 桥接适配器

每个适配器实现 `Adapter` 接口（`adapters/types.ts:192`）：`start(dir, opts?) → Promise<AgentHandle>`。`AgentHandle`（`types.ts:115`）暴露 `events`（一个 `AsyncIterable<NormalizedEvent>`）、`send`、`stop`，以及可选的控制方法（`interrupt`、`setModel`、`setPermissionMode`、`listSessions`、`getStatus`、`answerApproval`）。

| 适配器 | 传输方式 | 关键机制 |
|---------|-----------|---------------|
| `claude-code` (`adapters/claude-code.ts`) | Claude Agent SDK `query()` | `pathToClaudeCodeExecutable: findOnPath("claude")` — 编译后的二进制省略了 SDK 捆绑的 claude，因此它驱动用户 PATH 上的 claude。`canUseTool` 将工具权限路由到 web 审批事件。`includePartialMessages: true` + `thinking: adaptive` 用于流式推理。 |
| `opencode` (`adapters/opencode.ts`) | stdio JSON-RPC 上的 ACP（`opencode acp`） | `connectJsonRpc("opencode", ["acp"], dir)` → `initialize` → `session/new`。`session/update` 通知被归一化；`session/request_permission` 路由到审批注册表。模型/模式通过 `unstable_setSessionModel` / `session/set_mode`。 |
| `opencode-serve` (`adapters/opencode-serve.ts`) | HTTP + SSE 上的 `opencode serve` | 可选启用（`--opencode-transport serve`）。派生 `opencode serve --port 0`，从 stdout 发现分配的端口，然后基于 `fetch` 的 HTTP。未验证的线协议形状（标记为 ASSUMPTION）。 |
| `codex` (`adapters/codex.ts`) | stdio 上的 `codex app-server` JSON-RPC | `initialize` → `initialized` → `thread/start`。`turn/start` 用于发送，`turn/interrupt` 用于取消。审批请求（`execCommandApproval`/`applyPatchApproval`）路由到注册表。 |
| `pi` (`adapters/pi.ts`) | `pi --mode rpc` 自定义 JSON-over-stdio | `spawnProcessIo("pi", ["--mode", "rpc"], dir)`。完全没有逐工具审批协议。`session_ready` 由三个 RPC 回复（`get_state`、`get_available_models`、`get_commands`）组装。`getStatus` 通过 `get_session_stats` + `get_state`。 |

`AGENT_CLI` 表（`adapters/index.ts:20`）将每种类型映射到其二进制名称和一行安装提示，由启动预检呈现。

### 事件归一化

每个适配器有一个配对的归一化模块（`apps/bridge-cli/src/normalize/*.ts`），将其 agent 的原始输出映射到统一的 `NormalizedEvent` 联合类型（`normalize/types.ts:76`）：

| 事件类型 | 用途 |
|------------|---------|
| `message` | 一个聊天轮次（用户或助手），带可选 `thinking` 标志 |
| `tool` | 一次工具调用：`started` → `completed`/`failed`，带 `input`/`output` |
| `file` | agent 创建/修改/删除的文件 |
| `output` | 流式文本（助手回复或推理增量） |
| `status` | 生命周期/进度：`session_ready`、`turn_usage`、`usage_update`、`session_list`、`status_snapshot`、`agent_exited`、`plan`、… |
| `error` | 来自 agent 或传输层的可恢复或不可恢复错误 |
| `approval` | 服务端发起的请求用户批准/拒绝某操作的请求 |

下游消费者（relay-client、服务端、web UI）只理解这七种形状——从不理解任何 agent 特定协议。例如，`normalizeClaudeCode`（`normalize/claude-code.ts:182`）根据 `raw.type`（`system`/`assistant`/`user`/`result`/`stream_event`）分支并将每个映射到归一化事件；`normalizeOpencode` 映射 ACP `session/update` 通知；`normalizePi` 解析 pi 的 JSON-RPC 行。

### 桥接中继

`RelayStore`（`packages/agent/src/bridge/relay-store.ts:19`）是实时数据层，每个会话有两个通道：`events↑`（agent → web）和 `commands↓`（web → agent）。它提供 `append`（分配单调 id，持久化到滚动窗口，通知订阅者）、`read`（回放 id > afterId 的事件）和 `subscribe`（实时推送）。

- **内存**（`createInMemoryRelayStore`，`relay-store.ts:52`）— 用于开发/测试。一个 `Map<string, RelayChannelState>` 带 `MAX_WINDOW=500` 事件环形缓冲区。
- **Redis**（`createRedisRelayStore`，`apps/server/src/redis-relay-store.ts:162`）— 用于生产。使用 `INCR` 分配 id，`RPUSH` + `LTRIM` 维护滚动窗口，`EXPIRE` 设置 TTL（列表 `WINDOW_TTL_SEC=900`，计数器 `SEQ_TTL_SEC=86400`——计数器在会话存活期间绝不能重置，否则重置后的事件会被静默丢弃为"已见过"），`PUBLISH`/`SUBSCRIBE` 用于实时推送。共享的订阅者连接按通道路由消息。

`pushEvents`（`bridge.ts:158`）追加到中继存储（顺序 id）并尽力通过 `appendMany` 持久化到 `bridge_messages`——持久化失败被记录并吞掉，因为它绝不能中断实时中继。`pollCommands`（`bridge.ts:185`）读取 `commands↓` 通道并兼作存活心跳（`bridgeSession.touch`）。Web 通过 `observe`（轮询）或 SSE 流读取 `events↑`。

`observeBridgeEvents`（`packages/api/src/bridge/stream.ts:23`）在读取**之前**订阅以保证不丢失任何事件：回放读取期间到达的实时事件被缓冲，然后在回放完成后按到达顺序刷新，通过 `seen` Set 按 id 去重。

Web 的 SSE 客户端（`apps/web/src/components/bridge/sse-client.ts`）使用 `fetch`（不是 `EventSource`，后者无法附加 bearer 头）读取 `/bridge/sessions/:id/stream` 路由，通过 `createSseParser` 泵送响应体。它在令牌刷新后对 401 重试一次，镜像 oRPC 链的拦截器，因为此 fetch 绕过了该链。

### 桥接终端（web UI）

`Terminal` 组件（`apps/web/src/components/bridge/terminal.tsx:228`）是一个桥接会话的实时视图。它组合了：

- **`TerminalHeader`**（`terminal-header.tsx:181`）— 显著的会话 id、连接状态（`TerminalStatus`）、能力摘要（来自 `session_ready` 的 `SessionStatusHeader`），以及操作集群：会话选择器、设置对话框、历史会话、结束按钮——每个都门控于 `caps`（能力矩阵）。
- **`TerminalFeed`**（`terminal-feed.tsx:74`）— 自动滚动的对话表面。`foldEventsToTurns`（`bridge-turns.ts:262`）将原始事件流折叠为可渲染的 `BridgeTurn`（user/assistant/status/task/plan/file/error/approval）。`WorkingSkeleton` 微光效果在进行中的轮次期间显示；`deriveTurnInFlight`（`terminal.tsx:162`）从尾部扫描，因此永远不会卡住（不依赖轮次完成事件，而 opencode/pi/codex 从不发出这些事件）。
- **`TerminalComposer`**（`terminal-composer.tsx:219`）— 带能力门控控制菜单（模型选择器、权限模式）的输入框，用于斜杠命令/技能的 `/`-选择器，以及发送/停止（当轮次可中断地进行中时，停止替换发送）。

`useBridgeTerminal`（`use-bridge-terminal.ts`）连接传输层：从 `history` 种子，连接 SSE 流，合并实时事件并去重，暴露 `sendInput`、`answerApproval`、`setModel`、`setPermissionMode`、`interrupt`、`listSessions`、`getStatus`，并从数据流上的最新状态事件派生 `sessionReady`/`turnUsage`/`usageUpdate`/`sessionList`。

实时用量芯片：`TurnUsagePanel` + `UsageUpdateLine` 仅在 `caps.usageMode === "stream"` 时渲染（claude/opencode 流式 `turn_usage`/`usage_update`；pi 通过 `getStatus` 轮询；codex 没有）。

### 桥接会话管理

- **会话选择器**（`local-agent-session-picker.tsx:124`）— 列出此令牌会话（最新优先）的下拉菜单，显示短 id、开始时间和实时/空闲/已结束状态。`useSessionSelection`（`local-agent-session-picker.tsx:46`）默认跟随最近的会话，直到用户显式选择一个。
- **历史会话**（`past-conversations.tsx`）— 门控于 `caps.sessionList`；调用 `listSessions` 控制方法，后者推送一个 `session_list` 状态事件（目前仅 claude-code 的适配器实现了此功能）。
- **结束会话**（`terminal-header.tsx:152`）— 电源按钮调用 `bridge.endSession`，将数据库状态翻转为 `ended`，并尽力向 `commands↓` 通道追加 `control: stop` 命令，使 CLI 的轮询循环告知本地 agent 停止。
- **设置对话框**（`local-agent-settings-dialog.tsx:134`）— 编辑令牌持久化的 `config`（appendSystemPrompt、effort、maxTurns、maxBudgetUsd），CLI 在 `startSession` 时获取并在启动时应用（目前为 claude-code）。还显示分配的记忆（Memories 标签页）。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `apps/bridge-cli/src/index.ts` | CLI 入口：parseArgs → selectAdapter → requireAgentCli → runBridgeSession |
| `apps/bridge-cli/src/args.ts` | `parseArgs`：`--agent`/`--token`/`--server`/`--dir`/`--label`/`--resume`/`--opencode-transport`/`--debug`，环境变量回退 |
| `apps/bridge-cli/install.sh` | 独立二进制安装器（Bun --compile、GitHub Releases、PATH 提示） |
| `apps/bridge-cli/src/adapters/index.ts` | `selectAdapter`、`AGENT_CLI`（每种类型的二进制 + 安装提示） |
| `apps/bridge-cli/src/adapters/types.ts` | `Adapter`, `AgentHandle`, `AgentCapabilities`, `StatusSnapshotDetail`, `AgentStartConfig` |
| `apps/bridge-cli/src/adapters/claude-code.ts` | Claude Agent SDK 适配器：`query()`、`canUseTool` 审批、`listSessions`、`getStatus` |
| `apps/bridge-cli/src/adapters/opencode.ts` | ACP 适配器：`opencode acp` JSON-RPC、session/update、request_permission |
| `apps/bridge-cli/src/adapters/opencode-serve.ts` | `opencode serve` HTTP+SSE 适配器（可选启用，未验证） |
| `apps/bridge-cli/src/adapters/codex.ts` | `codex app-server` JSON-RPC 适配器：thread/start、turn/start、turn/interrupt |
| `apps/bridge-cli/src/adapters/pi.ts` | `pi --mode rpc` 适配器：从 3 个 RPC 组装 session_ready、getStatus 轮询 |
| `apps/bridge-cli/src/adapters/process-io.ts` | `findOnPath`、`spawnProcessIo`：stdio 管道、ENOENT 处理 |
| `apps/bridge-cli/src/normalize/types.ts` | `NormalizedEvent` 联合类型（7 种）、`userMessageEvent` |
| `apps/bridge-cli/src/normalize/claude-code.ts` | `normalizeClaudeCode`：stream-json → 归一化事件 |
| `apps/bridge-cli/src/normalize/opencode.ts` | `normalizeOpencode`：ACP session/update → 归一化 |
| `apps/bridge-cli/src/normalize/codex.ts` | `normalizeCodex`：app-server 通知 → 归一化 |
| `apps/bridge-cli/src/normalize/pi.ts` | `normalizePi`：pi RPC 行 → 归一化 |
| `apps/bridge-cli/src/relay-client.ts` | `forwardEvents`（批量推送 + 重试队列）、`runBridgeSession`（推送 + 轮询并发） |
| `apps/bridge-cli/src/relay-transport.ts` | `createRelayTransport`：基于 fetch 的 oRPC 客户端，带 `bt_` bearer |
| `apps/bridge-cli/src/poll-loop.ts` | `pollLoop`：带退避的 pollCommands、`control: stop` 处理 |
| `apps/bridge-cli/src/commands.ts` | `parseCommandText`、`dispatchCommands`：文本/审批/控制路由 |
| `packages/api/src/routers/bridge.ts` | `bridgeRouter`：token CRUD、startSession、pushEvents、pollCommands、observe、history、sendInput、endSession |
| `packages/agent/src/bridge/relay-store.ts` | `RelayStore` 接口、`createInMemoryRelayStore`、`MAX_WINDOW`、`WINDOW_TTL_SEC` |
| `apps/server/src/redis-relay-store.ts` | `createRedisRelayStore`：INCR/RPUSH/LTRIM/PUBLISH、`SEQ_TTL_SEC=86400` |
| `packages/api/src/bridge/stream.ts` | `observeBridgeEvents`（订阅→读取→去重）、`resolveStreamAuth`、SSE 路由 |
| `apps/web/src/components/bridge/terminal.tsx` | `Terminal`：header + feed + composer、`useTerminalView`、`deriveTurnInFlight` |
| `apps/web/src/components/bridge/terminal-header.tsx` | 会话 id、状态、选择器、设置、历史会话、结束按钮 |
| `apps/web/src/components/bridge/terminal-feed.tsx` | 自动滚动数据流、`WorkingSkeleton`、空状态 |
| `apps/web/src/components/bridge/terminal-composer.tsx` | 输入框、模型/权限菜单、`/`-选择器、发送/停止 |
| `apps/web/src/components/bridge/bridge-turns.ts` | `foldEventsToTurns`：原始事件 → 可渲染轮次 |
| `apps/web/src/components/bridge/bridge-session-status.ts` | `SessionReadyDetail`、`TurnUsageDetail`、`UsageUpdateDetail` 解析 |
| `apps/web/src/components/bridge/agent-capabilities.ts` | `capabilities(kind)`：按 agent 类型的能力矩阵 |
| `apps/web/src/components/bridge/bridge-transport.ts` | `BridgeTransport`：SSE 连接、history、observe、sendInput |
| `apps/web/src/components/bridge/sse-client.ts` | `connectBridgeStream`：基于 fetch 的 SSE、401 刷新重试 |
| `apps/web/src/components/bridge/local-agent-session-picker.tsx` | 会话下拉菜单、`useSessionSelection` |
| `apps/web/src/components/bridge/local-agent-settings-dialog.tsx` | 设置模态框：General/Config/Memories 标签页 |

## 数据流

### 会话启动（CLI → 服务端 → agent）

```
better-agent-bridge --agent claude-code --token bt_… --server https://…
  → parseArgs → selectAdapter → requireAgentCli（PATH 检查）
  → createRelayTransport(serverUrl, token)
  → transport.startSession({agentKind, label})
    → bridge.startSession (bridgeProcedure, bt_ 认证)
    → 创建 bridge_sessions 行，返回 { sessionId, config }
  → adapter.start(dir, { resume, config })
    → claude: query({ pathToClaudeCodeExecutable: findOnPath("claude"), … })
    → opencode: connectJsonRpc → initialize → session/new
    → codex: connectJsonRpc → initialize → thread/start
    → pi: spawnProcessIo → writeLine(get_state/get_available_models/get_commands)
  → runBridgeSession（推送 + 轮询循环并发）
```

### 事件流（agent → web）

```
Agent 发出原始输出
  → 适配器归一化 → NormalizedEvent 推入事件队列
  → forwardEvents: 批量（maxBatchSize=25, flushIntervalMs=250ms）
    → PushQueue（带退避重试, maxBufferedEvents=1000）
    → transport.pushEvents({ sessionId, events })
      → bridge.pushEvents (bridgeProcedure)
        → requireOwnedBridgeSession
        → appendPushedEvents: relayStore.append（顺序 id）+ 大小限制
        → persistEventsBestEffort: bridgeMessage.appendMany（尽力）
        → bridgeSession.touch
Web:
  → history（加载时种子, afterSeq=0）
  → connectBridgeStream（SSE, afterId=maxSeenId）
    → observeBridgeEvents: 订阅 → read(afterId) → 按 id 去重
    → onEvent → mergeEvents → foldEventsToTurns → BridgeChatRow
```

### 命令流（web → agent）

```
Web: 用户输入 → bridge.sendInput({ sessionId, data: text })
  → relayStore.append(sessionId, "commands", data)
CLI pollLoop: pollCommands({ sessionId, afterId })
  → relayStore.read(sessionId, "commands", afterId)
  → dispatchCommands:
    → text → sink.send(text) → adapter.send → agent 输入
    → approval → sink.answerApproval(requestId, optionId)
    → control: stop → pushStoppedByServerStatus + 返回（循环结束）
    → control: interrupt → sink.interrupt → session.interrupt()
    → control: setModel → sink.setModel → session.setModel()
    → control: setPermissionMode → sink.setPermissionMode
    → control: listSessions → sink.listSessions → 推送 session_list 事件
    → control: getStatus → sink.getStatus → 推送 status_snapshot 事件
  → afterIdRef 推进过每个命令（无论是否分发）
```

### 会话结束

```
Web: 结束按钮 → bridge.endSession({ sessionId })
  → bridgeSession.end（数据库状态 → "ended"）
  → 尽力 relayStore.append("commands", { type:"control", action:"stop" })
CLI pollLoop: 收到 control:stop
  → pushStoppedByServerStatus（状态事件到 events↑）
  → 循环返回 → handle.stop()（在 runBridgeSession 的 finally 中）
  → 进程退出
```

## 设计理由

- **独立二进制（Bun --compile）** — CLI 嵌入了运行时，因此用户不需要 Node.js。它不捆绑任何 agent CLI，因此 `requireAgentCli` 的预检在会话中途令人困惑的派生错误之前捕获缺失的 `claude`/`opencode`/`codex`/`pi`。
- **统一事件模型** — 七种 `NormalizedEvent` 形状意味着中继、服务端和 web 永远不需要理解 agent 特定协议。添加新 agent 只需一个适配器 + 一个归一化模块。
- **`pathToClaudeCodeExecutable`** — 编译后的二进制丢弃了 SDK 捆绑的 claude，因此适配器通过 `findOnPath("claude")` 将 SDK 指向用户 PATH 上的 `claude`。
- **先订阅后读取** — `observeBridgeEvents` 在读取回放缓冲区之前订阅实时通道，保证不丢失任何事件。回放期间的实时事件被缓冲并在之后刷新，按 id 去重。
- **尽力持久化** — `pushEvents` 持久化到 `bridge_messages` 但吞掉失败；实时中继（内存/Redis）是实时数据流的权威来源，`history` 在重载时种子 web。
- **顺序中继 id，非顺序数据库 seq** — 中继追加是顺序的（每次从前一个分配下一个 id）；Postgres 持久化不是，因此单独批量处理。Web 按中继 id 去重，`history` 的 seq 共享相同编号，因此回放后接实时事件能干净合并。
- **能力矩阵，而非 agent 检查** — `capabilities(kind)` 返回每种类型的静态矩阵；每个可选 UI 表面（选择器、历史会话、用量芯片、中断按钮）都门控于它。UI 中没有 `if (agentKind === "claude")`。
- **`deriveTurnInFlight` 尾部扫描** — "工作中"骨架从最后一个可渲染事件派生，而非轮次完成事件（opencode/pi/codex 从不发出）。这防止骨架永远卡住。
- **Redis seq TTL >> 窗口 TTL** — 计数器键有 24 小时 TTL（列表为 15 分钟），因为消费者持有持久的高水位标记；如果 `INCR` 重置，每个重置后的事件都会被静默丢弃为"已见过"。
- **SSE 上的去重刷新** — SSE 客户端绕过 oRPC 链，因此它重新实现了 401→刷新→重试一次模式（`sse-client.ts` 中的 `openStream`）。
- **控制命令 vs 文本** — `control: stop` / `interrupt` / `setModel` 等是结构化记录，而非文本，因此 CLI 能区分"停止 agent"和"发送此文本"。
- **空闲退避上限** — pollLoop 在空闲时退避到 2 秒（而非 5 秒+），因此用户输入的第一个命令最多 ~2 秒被拾取；桥接是交互式的，不是批量轮询器。

## 配置

| 配置项 | 位置 | 默认值 | 备注 |
|------|----------|---------|-------|
| Agent 类型 | `adapters/types.ts:5` | `claude-code, opencode, codex, pi` | 镜像于 `bridge.ts:19` `AGENT_KINDS` |
| Opencode 传输 | `args.ts:74` | `acp` | `--opencode-transport serve` 选择启用 HTTP+SSE |
| 中继滚动窗口 | `relay-store.ts:15` `MAX_WINDOW` | 500 | 每个会话/方向为回放保留的事件数 |
| 中继窗口 TTL | `relay-store.ts:17` `WINDOW_TTL_SEC` | 900（15 分钟） | Redis 列表 TTL |
| 中继 seq TTL | `redis-relay-store.ts:21` `SEQ_TTL_SEC` | 86400（24 小时） | 计数器键 TTL——会话存活期间绝不能重置 |
| 推送批量大小 | `relay-client.ts:30` | 25 | `DEFAULT_MAX_BATCH_SIZE` |
| 推送刷新间隔 | `relay-client.ts:31` | 250ms | `DEFAULT_FLUSH_INTERVAL_MS` |
| 推送重试缓冲 | `relay-client.ts:36` | 1000 | `DEFAULT_MAX_BUFFERED_EVENTS` |
| 轮询最小间隔 | `poll-loop.ts:13` | 500ms | `DEFAULT_MIN_INTERVAL_MS` |
| 轮询最大间隔 | `poll-loop.ts:17` | 2000ms | `DEFAULT_MAX_INTERVAL_MS`（空闲退避上限） |
| 轮询退避因子 | `poll-loop.ts:18` | 2 | `BACKOFF_FACTOR` |
| 最大推送批量（服务端） | `bridge.ts:21` `MAX_PUSH_BATCH` | 50 | 每次 `pushEvents` 调用的事件数 |
| History 默认限制 | `bridge.ts:28` | 500 | `DEFAULT_HISTORY_LIMIT` |
| History 最大限制 | `bridge.ts:30` | 500 | `MAX_HISTORY_LIMIT` |
| Agent CLI 安装提示 | `adapters/index.ts:20` `AGENT_CLI` | 按类型 | `claude`：`npm i -g @anthropic-ai/claude-code`；`opencode`：`curl -fsSL https://opencode.ai/install \| bash`；`codex`：`npm i -g @openai/codex`；`pi`：见 GitHub |
| 安装目录 | `install.sh:16` | `~/.better-agent/bin` | 用 `INSTALL_DIR` 覆盖 |
| Claude 权限模式 | `adapters/claude-code.ts:39` | `default, acceptEdits, bypassPermissions, plan, dontAsk, auto` | `PERMISSION_MODES` 集合 |
| Opencode 权限模式 | `agent-capabilities.ts:76` | `build, plan` | `OPENCODE_PERMISSION_MODES` |
| 桥接令牌前缀 | `bridge.ts:17` | `bt_` | `TOKEN_PREFIX` |
| 环境变量回退 | `args.ts:110-115` | `BETTER_AGENT_BRIDGE_TOKEN`、`BETTER_AGENT_BRIDGE_SERVER` | token/server 无需每次运行都输入 |

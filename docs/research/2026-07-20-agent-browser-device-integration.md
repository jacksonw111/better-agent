# agent-browser / agent-device 集成调研

日期：2026-07-20
状态：调研完成，给出推荐
实测环境：macOS（darwin 25.3.0，arm64），Node 24，scratchpad 隔离安装
版本：`agent-browser@0.32.3`、`agent-device@0.19.3`

---

## 摘要

**能集成，而且比预想的简单——但推荐的不是 MCP 路径。**

三条关键发现改变了结论：

1. **两者都原生提供 stdio MCP server**（`agent-browser mcp`、`agent-device mcp`），实测握手成功。但**两者都只有 stdio，没有 HTTP/SSE**——我们现有的 HTTP-only MCP 链路无法直接复用。
2. **我们四个 runtime 里只有 claude-code 真正接了 MCP。** opencode 硬编码传 `mcpServers: []`，codex 和 pi 完全没有 MCP 接线。所以「走 MCP」实际只覆盖 1/4 的 runtime，却要改 schema + resolve 链路 + 四个 adapter。
3. **MCP 工具表的上下文开销极大**：agent-device 55 个工具 = 184 KB ≈ **46k tokens**；agent-browser core profile 29 个工具 = 50 KB ≈ **12.5k tokens**。而同样的任务走 shell CLI，一次 snapshot 只要 **74 字节**。

**推荐：先做「托管 CLI」路径（P0），MCP 路径降级为 claude-code 专属的可选增强（P2），视口接入单独评估（P1，仅 agent-browser）。**

托管 CLI 路径几乎零工作量（照抄 `git`/`gh` 的 inventory 模式），却能覆盖全部四个 runtime，且上下文效率高出两个数量级。

另外：**agent-device 在没有 Xcode / Android SDK 的机器上直接 doctor fail**，不适合默认托管安装；agent-browser 则自带静态 Rust 二进制、开箱可用。两者应区别对待。

---

## A. MCP 接口形态

### A1. 安装足迹（实测）

```
$ npm install agent-browser agent-device
added 3 packages, and audited 4 packages in 41s
found 0 vulnerabilities

$ du -sh node_modules/*
 84M	node_modules/agent-browser
2.6M	node_modules/agent-device
1.2M	node_modules/yaml
```

**agent-browser（84 MB）**：npm 包内直接塞了 7 个平台的预编译 Rust 静态二进制，无运行时依赖：

```
$ ls -la node_modules/agent-browser/bin/
755  agent-browser-darwin-arm64        10.9M
644  agent-browser-darwin-x64          11.9M
644  agent-browser-linux-arm64         10.9M
644  agent-browser-linux-musl-arm64    10.8M
644  agent-browser-linux-musl-x64      12.4M
644  agent-browser-linux-x64           12.5M
644  agent-browser-win32-x64.exe       12.2M
755  agent-browser.js                   3.1K
```

单平台实际只用 ~11 MB。**依赖零**（除 npm 包自身），不需要 Node 以外的运行时。

浏览器：`agent-browser install` 会下载 Chrome for Testing（179 MB）。**实测这一步在本机网络下超时失败三次**：

```
$ agent-browser install
  Downloading Chrome 151.0.7922.34 for mac-arm64
  9/179 MB (5%) ... 107/179 MB (60%)
  Retrying download (attempt 2/3)
  ...
✗ Download error: error decoding response body: request or response body error: operation timed out
```

**但这不阻塞使用**——它自动回落到系统已装的 Chrome，后续命令全部正常工作。这是个重要的容错性优点，但也意味着**托管安装器需要处理 179 MB 下载失败的情况**（回落系统 Chrome / 允许 `--cdp` 连已有浏览器）。

**agent-device（2.6 MB）**：纯 JS，体积小，但真正的依赖在包外——见 E 节。

### A2. 是否暴露 MCP server？传输是什么？

**都暴露，都是 stdio，都实测握手成功。**

**agent-browser**：

```
$ agent-browser mcp --help
agent-browser mcp - Start an MCP stdio server

Usage: agent-browser mcp [--tools <profiles>]

Starts a Model Context Protocol server over stdio. MCP clients launch this
command as a subprocess and communicate with newline-delimited JSON-RPC.
stdout is reserved for MCP protocol messages; logs and diagnostics use stderr.
The server defaults to MCP protocol 2025-11-25 and accepts older supported
client protocol versions during initialization.
```

实测 initialize（喂 `protocolVersion: 2025-06-18`）：

```json
{"id":1,"jsonrpc":"2.0","result":{"capabilities":{"tools":{}},"instructions":"Use the typed agent_browser_* tools to control a browser. Active MCP tools profile(s): core. Prefer agent_browser_snapshot after navigation to obtain stable element refs before clicking or typing.","protocolVersion":"2025-06-18","serverInfo":{"name":"agent-browser","title":"agent-browser","version":"0.32.3"}}}
```

协议协商正确（降级到客户端的 2025-06-18），stderr 干净，退出码 0。

**agent-device**：

```
$ agent-device mcp --help
agent-device mcp

Start the official stdio MCP server. It exposes structured command tools backed by the agent-device client.

Usage:
  agent-device mcp
```

实测 initialize：

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"agent-device","version":"0.19.3"}}}
```

注意：**agent-device 无视客户端请求的 `2025-06-18`，硬回 `2025-11-25`**。这是轻微的协议不合规（MCP 规范要求服务端回落到双方都支持的版本）。严格的 MCP 客户端可能会因此拒绝连接——是个需要留意的兼容风险。

`package.json` 里还有 `"mcpName": "io.github.callstackincubator/agent-device"`，说明已在 MCP registry 注册。

### A3. 能否同时以 HTTP/SSE 暴露？——**不能。这是关键否定结论。**

- **agent-browser**：help 明确写 "Start an MCP **stdio** server"，`Usage: agent-browser mcp [--tools <profiles>]` 只有 `--tools` 一个参数，无 `--port` / `--http` / `--sse`。对二进制 strings 全量搜索 MCP 相关字符串，只出现 `src/mcp.rs`、stdio 相关描述、以及 stdio 形态的客户端配置示例（`"args": ["mcp"]` / `["mcp","--tools","all"]`），**无任何 HTTP/SSE transport 痕迹**。
- **agent-device**：`agent-device mcp` 无任何参数，help 明写 "stdio MCP server"。

> 注：agent-browser 另有 `dashboard` 和 `stream` 两个 HTTP/WS 服务，但那是**视口/UI 服务，不是 MCP transport**（见 D 节）。不要混淆。

**结论：想走 MCP，我们必须支持 stdio。现有 HTTP-only 链路无法复用。** 这直接推翻了任务书里「最省事路径」的假设。

### A4. 工具清单与 schema 复杂度（实测 `tools/list`）

| | 工具数 | schema 字节 | ≈tokens | 平均参数/工具 | 最大参数 |
|---|---|---|---|---|---|
| agent-browser（core profile，默认） | 29 | 50,149 | ~12,537 | 11.8 | 17 |
| agent-browser（all profile） | ~130 | 未测（估 200k+） | ~50k+ | — | — |
| agent-device（唯一 profile） | 55 | 183,827 | **~45,957** | 27.4 | 44 |

agent-browser 命名规范统一（`agent_browser_open` / `_snapshot` / `_click` / `_fill` …），有 profile 分级（core/network/state/debug/tabs/react/mobile/all）可控制上下文膨胀。

agent-device 命名是裸命令名（`alert`、`click`、`fill`、`open`、`snapshot`…），**没有前缀命名空间**——和其他 MCP server 或 runtime 内置工具**极易撞名**（`click`、`open`、`get`、`find`、`is`、`logs` 全是通用词）。这是实打实的集成风险。

agent-device 每个工具都重复携带一整套设备选择参数（`session`/`platform`/`deviceTarget`/`target`/`device`/`udid`/`serial`/`iosSimulatorDeviceSet`/`iosXctestrunFile`…），平均 27.4 个参数、最多 44 个——这就是 46k tokens 的来源。

**web 工具卡片渲染判断**：两者的 `tools/call` 返回都是标准 MCP `content` + `structuredContent`，我们现有 `bridge-tool-card.tsx` / `tool-output-preview.tsx` 的通用 MCP 卡片能直接兜底渲染，**不需要为集成而改**。但要做得好看（截图内联、snapshot 树形化）需要专门的 renderer——这是可选增量，不是阻塞项。

---

## B. 四个 runtime 的兼容性

### B5. 结论表

先说 SDK 层能力，再说**我们实际接没接**——这两件事差别很大。

| runtime | 底层支持的 MCP 传输 | **我们当前实际接线** | 证据 |
|---|---|---|---|
| **claude-code** | stdio / SSE / HTTP / in-SDK | ✅ 已接，但**硬编码 `type: "http"`** | `sdk.d.ts:1032`；`claude-code-startup-config.ts:63` |
| **opencode** | ACP `session/new` 收 `mcpServers`（ACP 原生是 stdio 形态） | ❌ **硬编码空数组** | `opencode.ts:229` → `mcpServers: []` |
| **codex** | codex 自身 `~/.codex/config.toml` 支持 stdio MCP | ❌ **完全没接线** | `grep -c mcpServers codex.ts` → `0` |
| **pi** | 未知 / 无接线 | ❌ **完全没接线** | `grep -c mcpServers pi.ts` → `0` |

claude-code SDK 确认支持 stdio：

```ts
// sdk.d.ts:1131
export declare type McpStdioServerConfig = {
    type?: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
    ...
};
// sdk.d.ts:1032
export declare type McpServerConfig = McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfigWithInstance;
```

而我们只用了其中的 http 分支：

```ts
// claude-code-startup-config.ts
record[server.name] = {
    type: "http",          // ← 硬编码
    url: server.url,
    headers: server.headers,
};
```

**这张表是本次调研最重要的产出。** 「走 MCP 集成 agent-browser/agent-device」听起来是给平台加能力，实际上**前置依赖是「先把 MCP 接进另外三个 runtime」——那是一个独立的、比本任务大得多的工程**。只为了这两个工具去做它，性价比很低。

### B6. 若必须支持 stdio，改动清单

1. **DB schema**（`packages/db/src/schema/mcp.ts`）：`url` 从必填改为传输判别式联合。新增 `transport`（`"http" | "stdio"`）、`command`、`args`(jsonb)、`env`(jsonb，含密文)。`url`/`authHeaderCipher` 变为 http 专属。需要 migration（记住：用 `db:migrate` 不是 `db:push`）。
2. **resolve 链路**（`packages/api/src/routers/bridge-mcp-resolve.ts` + `ResolvedMcpServer` 接口，在 `start-config.ts` 和 `bridge-mcp-resolve.ts` **两处重复声明**，都要改）：返回判别式联合。
3. **安全审查（重量级，不可跳过）**：现在 `ResolvedMcpServer` 只能让 CLI 连一个 URL；加了 stdio 就等于**允许服务端下发任意 command + args + env 到用户机器上执行**。这是一个 RCE 形状的新攻击面，必须配套白名单（只允许已 detect 到的托管工具）或强制用户本地确认。**这一条是 stdio 路径的真实成本，不是 schema 改动。**
4. **claude-code adapter**：`claudeMcpServers()` 按判别式分支产出 stdio/http 两种 config——本身很简单（~10 行）。
5. **另外三个 adapter**：opencode 要把 `[]` 换成真实转换 + 验证 ACP 侧行为；codex 要新写 config.toml 注入；pi 要先调研有无 MCP 支持。
6. **web/admin UI**：MCP server 注册表单要支持两种形态。

**工作量**：schema + resolve + claude-code = **2～3 人日**；安全审查与白名单 = **2～3 人日**；另外三个 runtime 接线 = **5～8 人日**（其中 pi 存在「查完发现不支持」的风险）。合计 **9～14 人日**。

---

## C. 非 MCP 路径：当作托管 CLI（实测）

**实测体验：优秀，明显优于 MCP 路径。**

实际跑通的一串命令（用系统 Chrome，Chrome-for-Testing 下载失败后自动回落）：

```
$ agent-browser open example.com
[agent-browser] launched browser
✓ Example Domain
  https://example.com/

$ agent-browser snapshot -i
- heading "Example Domain" [level=1, ref=e1]
- link "Learn more" [ref=e2]
--- snapshot bytes: 74

$ agent-browser read example.com
# Example Domain

This domain is for use in documentation examples without needing permission. Avoid use in operations.

Learn more
--- bytes: 132
```

**关键对比数据**：

| 路径 | 拿到一个可交互页面快照的上下文成本 |
|---|---|
| MCP（agent-browser core） | ~12,537 tokens 的工具表 **+** 每次调用的结果 |
| MCP（agent-device） | ~45,957 tokens 的工具表 **+** 每次调用的结果 |
| **shell CLI** | **74 字节**（≈19 tokens），工具表成本为 **0** |

差距是**两到三个数量级**。

原因是 agent-browser 专门为「agent 通过 shell 调用」设计：

- 输出是紧凑的 accessibility tree，带稳定 `@ref`（`@e1`/`@e2`），可直接用于后续 `click @e2`。
- 有 daemon 常驻，浏览器状态跨命令保持，所以 `open && snapshot && click` 可以串成一行 shell。
- 自带 skills 系统：`agent-browser skills get core --full` 让 agent 自己按需拉取用法文档——**这正好替代了 MCP 工具表的作用，但是惰性的、按需的**，不占常驻上下文。
- 全部命令支持 `--json`。

CLI help 里甚至有专门的 "Start here (for AI agents)" 段落和 "Command Chaining" 段落。这个工具的设计目标就是被 shell 调用。

**这条路径我们的工作量接近零**：`detect-inventory.ts` 里 `MANAGED_TOOLS` 数组加两项即可：

```ts
const MANAGED_TOOLS: ManagedToolName[] = ["git", "gh"];
// → ["git", "gh", "agent-browser", "agent-device"]
```

现有逻辑就是 PATH 探测 + 上报，`ManagedToolName` 类型和上报链路都已存在。**覆盖全部四个 runtime**（任何 runtime 都会 shell），无需碰 schema、resolve 或任何 adapter。

---

## D. 视口/画面接入

### agent-browser stream（实测）

```
$ agent-browser stream status --json
{"success":true,"data":{"connected":true,"enabled":true,"port":55693,"screencasting":false,...},"error":null}
```

实际连上 WS 抓帧：

```
OPEN
frame 1 TEXT 134B: {"connected":true,"engine":"chrome","recording":false,"screencasting":false,"type":"status","viewportHeight":720,"viewportWidth":1280}
frame 2 TEXT 157B: {"tabs":[{"active":true,"label":null,"tabId":"t1","title":"example.com","type":"page","url":"https://example.com/"}],"timestamp":1784539667969,"type":"tabs"}
frame 3 TEXT 133B: {"connected":true,...,"screencasting":true,...}
```

**协议形态**：自定义的 JSON 文本 WebSocket 协议，消息带 `type` 判别字段（`status` / `tabs` / 以及连上后触发的 CDP screencast 画面帧）。底层是 CDP `Page.startScreencast`，画面帧为 base64 JPEG/PNG。

**能否复用现有 VNC 面板？——不能。** 我们的 `vnc-viewer.tsx` 走的是 RFB 协议（noVNC），和这个 JSON+base64 协议完全不同，零复用。

**但需要另写的 viewer 很简单**：连 WS → 按 `type` 分发 → 画面帧塞进 `<img src="data:image/jpeg;base64,...">` 或 canvas。比 noVNC 简单得多。可复用的是 `remote-desktop-panel.tsx` 的**面板骨架/布局/relay 转发模式**（`vnc-relay.ts` 的 WS 中继思路直接适用，因为一样是 localhost WS 要穿透到 web）。

`stream enable` 支持 `--port`，也支持 `AGENT_BROWSER_STREAM_PORT` 环境变量固定端口——对我们的 relay 编排友好。另外 `stream` 只读画面，**交互仍要走 CLI/MCP 命令**，不像 VNC 那样能直接回传鼠标键盘。

**工作量**：relay 侧照抄 `vnc-relay.ts` ~1 人日；web viewer ~2 人日；编排/生命周期（何时 enable、端口发现、session 绑定）~1～2 人日。合计 **4～5 人日**。

### agent-device 截图/录屏

有 `screenshot`、`diff screenshot`、`perf`、`record` 相关能力，但**无常驻视口流**（无 `stream` 等价物）。只能做「按需截图，逐帧推给 web」，体验远不如 agent-browser 的 screencast。加上 E 节的环境门槛，**agent-device 的视口接入本次不建议做**。

---

## E. 平台与运维

### agent-browser：✅ 适合托管安装

- 静态 Rust 二进制，macOS(arm64/x64) + Linux(gnu/musl, arm64/x64) + Windows 全覆盖。
- 单平台 ~11 MB，无运行时依赖。
- 需要 Chrome：优先用自己下的 Chrome for Testing（179 MB），**失败时自动回落系统 Chrome**（本次实测就是这个路径，全部功能正常）。
- 无特殊系统权限要求（除非用 `--profile` 复用真实 Chrome 配置——那会碰用户登录态，需要明确告知）。
- 也支持 `brew install` / `cargo install`，托管安装器有多条路可选。

### agent-device：⚠️ 不适合默认托管安装

实测本机 doctor 直接失败：

```
$ agent-device doctor
✓ agent-device: agent-device 0.19.3 using /Users/john/.agent-device
- session: No active session named cwd:bf88804cb24032cf:default. Doctor will use device inventory only.
⨯ device: No local devices found; Android inventory failed: adb not found in PATH; Apple inventory failed: unable to find utility "simctl", not a developer tool or in PATH.
  run: agent-device devices
Doctor: fail
Blockers found before the run.

$ agent-device devices
(空)
```

**这是一台正常的 macOS 开发机**，仍然 fail。它要求：

- **iOS/tvOS**：完整 Xcode（不只是 Command Line Tools）——`simctl` 缺失就是这个原因。数十 GB。另外 `agent-device prepare` 要预热 XCTest runner，真机还要签名配置。
- **Android/Android TV**：Android SDK platform-tools（`adb`）。
- **物理设备**：额外的配对/签名流程（`agent-device help physical-device`）。

npm 包本身只有 2.6 MB，但**真实前置依赖是几十 GB 的 IDE 工具链**。

结论：agent-device 只对「已经在做移动端开发」的用户有价值。应该做成**检测到才上报可用**（PATH 有 `agent-device` **且** doctor 通过），而不是我们主动安装。

---

## 三个集成深度对比

| | **① 托管 CLI** | **② MCP 接入** | **③ 视口接入** |
|---|---|---|---|
| **改动清单** | `detect-inventory.ts` 的 `MANAGED_TOOLS` 加 2 项；`ManagedToolName` 类型扩展；安装器加 agent-browser（agent-device 仅检测）；web 上报 UI 顺带显示 | DB schema 传输判别式联合 + migration；`ResolvedMcpServer`（2 处声明）；`bridge-mcp-resolve.ts`；**stdio 下发的安全白名单**；claude-code adapter 分支；opencode/codex/pi 从零接线；web/admin 注册表单 | `vnc-relay.ts` 模式复刻一份 WS relay；新写 screencast viewer 组件；stream 生命周期编排；`remote-desktop-panel` 骨架复用 |
| **工作量** | **0.5～1 人日** | **9～14 人日** | **4～5 人日** |
| **覆盖 runtime** | **4/4** | 1/4（现状）；4/4 需全额工作量 | 4/4（与 runtime 无关） |
| **上下文成本** | ~0（按需 skills） | 12.5k～46k tokens 常驻 | 不占 LLM 上下文 |
| **风险** | 低。主要是 Chrome 179 MB 下载可能失败（有回落）；agent-device 环境门槛 | **高**：stdio 下发 = 服务端指定本机执行命令，RCE 形状攻击面；agent-device 协议版本不合规；工具裸命名撞名（`click`/`open`/`get`）；pi 可能根本不支持 | 中。协议是 agent-browser 私有的，可能随版本变；只读画面无法交互 |

---

## 推荐与实施顺序

### 推荐：先做 ①，观察后再决定 ③，② 暂缓

**P0 —— 托管 CLI（0.5～1 人日）**

把 agent-browser 和 agent-device 加进 `MANAGED_TOOLS`，照抄 `git`/`gh` 的检测上报。agent-browser 纳入安装器托管；agent-device **只检测不安装**（并在 UI 上标注需要 Xcode/adb）。

理由：覆盖 4/4 runtime、上下文成本近零、工作量近零、风险低。实测证明 agent-browser 的 shell 体验就是为此设计的——`snapshot` 74 字节带 `@ref`，比任何 MCP 方案都省。**这一步就能拿到这次集成 90% 的价值。**

**P1 —— 观察真实用量，再决定视口接入（4～5 人日）**

P0 上线后看用户是否真在用 agent-browser。**如果用了**，视口接入的价值很高——「远程控制本机 agent」的场景下，用户看不见浏览器在干什么是真实痛点，而这正是我们 CUA/VNC 面板已经建立的产品直觉。协议简单（JSON + base64 帧），比 noVNC 好写。**如果没人用，直接不做。**

**P2 —— MCP 暂缓，且不要为这两个工具单独做**

不推荐现在做，三个理由：

1. 收益覆盖面小：现状只有 claude-code 接了 MCP，而 claude-code 通过 shell 已经能完美使用这两个工具。
2. 成本被低估：真实成本不是 schema 改动，而是「服务端向本机下发可执行 command」的安全设计。
3. 上下文经济性反而更差：46k / 12.5k tokens 的常驻工具表 vs. 按需 skills。

**但**：如果将来因为别的原因（比如接入某个只有 stdio 的关键 MCP server）要做 stdio 支持，那时把这两个工具顺带纳入，边际成本很低。**stdio 支持应该由更广的需求驱动，而不是由这两个工具驱动。**

### 不可行的判定

- **「复用现有 HTTP MCP 链路」不可行。** 两者都只有 stdio，无 HTTP/SSE 模式（A3，已用 help + 二进制 strings 双重验证）。
- **「复用现有 noVNC 面板显示 agent-browser 画面」不可行。** 是私有 JSON+base64 协议，非 RFB，零复用（D，已实测抓帧）。
- **「把 agent-device 做成默认托管安装」不可行。** 干净 macOS 开发机上 doctor 即 fail，真实依赖是完整 Xcode / Android SDK（E，已实测）。

---

## 附：复现命令

```bash
mkdir -p /tmp/spike && cd /tmp/spike && npm init -y && npm install agent-browser agent-device

# MCP 握手
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"spike","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | ./node_modules/.bin/agent-browser mcp

# shell 路径
./node_modules/.bin/agent-browser open example.com
./node_modules/.bin/agent-browser snapshot -i
./node_modules/.bin/agent-browser close --all

# 视口流
./node_modules/.bin/agent-browser stream status --json
# 然后 ws://127.0.0.1:<port>

# 环境门槛
./node_modules/.bin/agent-device doctor
```

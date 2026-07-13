# claudecodeui (CloudCLI) 调研与对比报告

- 日期:2026-07-13
- 对象:https://github.com/siteboon/claudecodeui (现已改名 **CloudCLI**,`@cloudcli-ai/cloudcli` v1.36.1,AGPL-3.0)
- 方法:`git clone --depth 1`(HEAD `5884573`,2026-07-08),逐目录阅读 server 端路由/服务、前端组件、CLI 集成源码。以下所有功能项均以源码文件为证据,非 README 转述。
- 源码本地路径:`/private/tmp/claude-501/-Users-john-better-agent/8a4666de-0d98-48d8-9134-e351a0d1d3e7/scratchpad/claudecodeui`(下文相对路径均指该仓库)

---

## TL;DR

claudecodeui 已从"Claude Code 的 Web UI"演化为一个**本机自托管的多 agent IDE 工作台**(单用户、Express + SQLite + WS,同机运行),支持 claude / codex / cursor / opencode 四个 agent。它的核心竞争力不在传输层(没有 relay,server 必须跑在 CLI 所在机器上),而在 **IDE 化外围能力**:文件树 + CodeMirror 编辑器、node-pty 内置终端、22 个端点的完整 git 面板、全 provider 历史会话索引(SQLite + chokidar 实时监听)、ripgrep 跨会话全文搜索、图片/语音输入、Web Push 通知、PWA、Electron 桌面壳、插件系统、headless REST API(跑 agent 自动开 PR)、TaskMaster 看板。

**我们的差异化**(它没有):云端多用户 SaaS + relay 双工架构(网页在云上,agent 在用户本机)、pi 支持、codex/opencode 的交互式审批(它只有 claude 有审批,其余三个 provider 一律"无审批,只能调 sandbox 档位")、忙时 steer、账号配额面板、CUA/VNC 远程控制、动态能力握手。

**最该抄的三件事**:图片输入、全 provider 历史会话索引与管理(重命名/归档/搜索)、断线重连的 seq 精确重放 + pending 审批随订阅重投。

---

## 一、claudecodeui 功能全清单(带源码证据)

### 1. Agent 支持与驱动协议

| Agent | 驱动方式 | 证据 |
|---|---|---|
| Claude Code | **Agent SDK 进程内**(`@anthropic-ai/claude-agent-sdk` 的 `query()`,非 spawn CLI),`canUseTool` 回调做审批,`hooks.Notification` 做通知 | `server/claude-sdk.js:20,528,606` |
| Codex | **`@openai/codex-sdk`**(`new Codex()` → `startThread`/`resumeThread` → `runStreamed`),权限档映射为 `sandboxMode` + `approvalPolicy`('never'/'untrusted',**无交互审批**) | `server/openai-codex.js:196-214,260-299` |
| Cursor | **spawn `cursor-agent` CLI** + `--output-format stream-json`(cross-spawn 兼容 Windows) | `server/cursor-cli.js:74,134` |
| OpenCode | **每回合 spawn `opencode run --format json`**(一次性进程,非 serve 常驻;权限用 `--agent plan` / `--auto` / `OPENCODE_PERMISSION` env) | `server/opencode-cli.js:244`;能力矩阵注释 `provider-capabilities.service.ts:66-70` |

四个 runtime 共享统一签名 `(command, options, writer)`,由 provider-keyed map 分发(`server/modules/websocket/services/chat-websocket.service.ts:52-66`)。事件统一 normalize 成 `NormalizedMessage`(`server/modules/providers/list/*/​*-sessions.provider.ts` 里的 `normalizeMessage`)。

**能力矩阵是静态硬编码**(`server/modules/providers/services/provider-capabilities.service.ts:34-78`):只有 claude `supportsPermissionRequests: true`;cursor 无 token usage;前端据此显隐控件。

### 2. 会话管理(它最强的部分之一)

- **全 provider 会话索引进本地 SQLite**:每个 provider 有 `session-synchronizer`,扫描各家落盘目录并 upsert 进 DB:
  - claude:`~/.claude/projects/**/*.jsonl`(跳过 `subagents/` 子转录),会话名从 `~/.claude/history.jsonl` 反查 — `server/modules/providers/list/claude/claude-session-synchronizer.provider.ts:26,46-52`
  - codex:`~/.codex/sessions` rollout JSONL — `sessions-watcher.service.ts:25-27`
  - cursor:`~/.cursor/chats/<cwdId>/<sessionId>/store.db`,**只读打开 better-sqlite3 直接读 blobs 表** — `cursor-sessions.provider.ts:227-244`
  - opencode:`~/.local/share/opencode/opencode.db`(SQLite,读 session/message 表) — `opencode-sessions.provider.ts:118-165`
- **chokidar 实时监听**四个目录,防抖 500ms 后增量同步并向所有客户端广播 `session_upserted` — `server/modules/providers/services/sessions-watcher.service.ts:15-45`
- **会话生命周期 REST**:分页历史 `GET /sessions/:id/messages`(limit/offset)、重命名 `PUT /sessions/:id`、删除/归档 `DELETE`(带 force)、恢复 `POST /sessions/:id/restore`、归档列表、运行中列表 — `server/modules/providers/provider.routes.ts:543-592`
- **跨会话全文搜索**:用 `@vscode/ripgrep` 扫全部转录文件,SSE 流式返回带高亮 snippet — `server/modules/providers/services/session-conversations-search.service.ts:6`,路由 `provider.routes.ts:631`;前端接在命令面板里(`src/components/command-palette/sources/useSessionMessageSearch.ts`)
- resume:app 层 session id 与 provider-native id 在 DB 中映射,`chat.send` 时服务端查 DB 取 provider id 传给 runtime(客户端无法伪造 provider/path)— `chat-websocket.service.ts:137-205`

### 3. 聊天界面能力

- **传输**:单 WS 网关按 path 分流:`/ws`(聊天)、`/shell`(终端)、`/desktop-notifications`、`/plugin-ws/*` — `server/modules/websocket/services/websocket-server.service.ts:54-77`。无 HTTP 降级。
- **断线重连**:每个 run 的事件带单调 `seq`,内存缓冲最多 5000 条、完成后保留 5 分钟;客户端 `chat.subscribe { sessions:[{sessionId,lastSeq}] }` 精确重放漏掉的事件,并**把 pending 审批请求一并重投**(刷新页面审批卡不丢)— `chat-run-registry.service.ts:29-63`,`chat-websocket.service.ts:264-327`,`claude-sdk.js:816`(reconnectSessionWriter)
- **审批/权限**(仅 claude):`canUseTool` → WS `permission_request` → 前端 PermissionRequestsBanner + 按工具注册的审批面板(`src/components/chat/tools/configs/permissionPanelRegistry.ts`);55s 超时(可配),交互式工具(AskUserQuestion/ExitPlanMode)无限等待;"记住规则"用 `Bash(prefix:*)` 格式累积进 allowedTools — `claude-sdk.js:43-45,528-598`
- **工具渲染**:530 行集中式 `TOOL_CONFIGS` 注册表(one-line/collapsible/plan/hidden 四种形态 + 颜色/图标/动作)— `src/components/chat/tools/configs/toolConfigs.ts`;diff 渲染 `ToolDiffViewer.tsx`(+/- 行级);TodoList 渲染(`ContentRenderers/TodoList.tsx`);**subagent 分组**:SDK `parent_tool_use_id` → `SubagentContainer.tsx` 把子工具折叠进 Task 卡片(`claude-sdk.js:282-289`)
- **图片输入**:composer 拖拽/粘贴 → `POST /api/assets/images` 存 `~/.cloudcli/assets` → 服务端强校验"只允许 upload store 直接子文件"防路径穿越(`chat-websocket.service.ts:26-45`)→ claude 走 SDK streaming-input base64 content block(`claude-sdk.js:377-394`),codex/cursor/opencode 也支持(`shared/image-attachments.ts`)
- **语音输入 + TTS**:MediaRecorder 录音 → `/api/voice/transcribe`;`server/voice-proxy.js` 代理任意 OpenAI 兼容 STT/TTS 后端(OpenAI/Groq/本地 LocalAI 等);消息级"朗读"按钮(`useTts.ts`、`MessageSpeakControl.tsx`)
- **排队消息**:忙时输入落 `queued_message_<sessionId>`,**非当前查看的会话**在 run 结束后也会自动派发 — `src/hooks/useQueuedMessageAutoSend.ts:21-26`
- **其他**:token budget 状态条(`TokenUsageSummary.tsx`,context window 靠 env 假定 160k,`claude-sdk.js:318`)、`@` 文件提及(`useFileMentions.tsx:97`)、slash 命令菜单(`CommandMenu.tsx`)、KaTeX 数学渲染(package.json `katex`/`rehype-katex`)、消息复制、会话保护(运行中防误切换,`useSessionProtection.ts`)

### 4. IDE 类功能

- **文件浏览器**:文件树(简洁/详细两种视图、搜索、右键菜单、**拖拽上传**、图片查看器)— `src/components/file-tree/`(hooks/useFileTreeUpload.ts 等 20+ 文件)
- **代码编辑器**:CodeMirror 6(`@uiw/react-codemirror` + 各语言包 + `@codemirror/merge` + minimap),markdown 预览、二进制/媒体预览、快捷键 — `src/components/code-editor/`
- **内置终端**:服务端 `node-pty` 起真实 shell(`pty.spawn(shell, ..., { name: 'xterm-256color' })`),前端 `@xterm/xterm` + webgl/fit/clipboard addon,支持 resize、断线覆盖层、移动端选择;还有独立终端页 `standalone-shell` — `server/modules/websocket/services/shell-websocket.service.ts:5,337`,`src/components/shell/`
- **git 面板**:22 个端点 — status/diff/file-with-diff/stage/unstage/commit/branches/checkout/create-branch/delete-branch/commits/commit-diff/remote-status/fetch/pull/push/publish/discard/delete-untracked/revert-local-commit/initial-commit,以及 **AI 生成 commit message**(用 claude 或 cursor 一次性调用)— `server/routes/git.js:367-1584,988`;前端 Changes/History(提交图谱 CommitGraphStrip)/Branches 三 tab — `src/components/git-panel/`
- **命令面板**(cmdk):文件、会话、git 分支/提交、git 动作、会话消息搜索多 source 聚合 — `src/components/command-palette/`

### 5. 移动端 / PWA / 桌面

- PWA:`public/manifest.json` + service worker(只缓存 manifest,保证刷新拿最新资产)`public/sw.js`
- **Web Push 通知**:`web-push` + VAPID 密钥管理 + 订阅存 DB;通知编排器统一分发"需要审批 / run 完成 / 失败"事件 — `server/services/vapid-keys.js`、`server/modules/database/repositories/push-subscriptions.ts`、`src/hooks/useWebPush.ts`、`server/services/notification-orchestrator.js`
- **Electron 桌面 App**:多 tab(本地/远程 server)、深链 `cloudcli://`、桌面通知(经 `/desktop-notifications` WS)、SSH remote 跳 VSCode — `electron/main.js`、`electron/tabs.js`;GitHub Actions 出 mac/win 安装包
- 移动端专门处理:终端触摸选择(`mobileTerminalSelection.ts`)、移动菜单(`useMobileMenuHandlers.ts`)、composer 自适应

### 6. 认证与安全

- **单用户系统**:首个注册后即封注册("This is a single-user system")、bcrypt(12 rounds)+ JWT — `server/routes/auth.js:44`
- API key 体系(给 headless API 用)+ GitHub token 保管(clone 私有仓库)— `server/modules/database/repositories/api-keys.ts`、`github-tokens.ts`
- 图片路径穿越防护(见上)、平台模式 `IS_PLATFORM`(他们的付费云由外部代理做认证)— `server/routes/agent.js:22-30`

### 7. MCP / 模型 / Skills / 插件 / 其他

- **MCP 管理**:四个 provider 各有 mcp.provider(读写各家配置文件),支持"一键加到所有 provider"的全局操作 — `server/modules/providers/services/mcp.service.ts:55`,前端 `src/components/mcp/`
- **模型切换 + 思考力度**:每 provider 有 models.provider(cursor 的 806 行,动态探测);resume 时自动沿用会话原模型(`provider-models.service.resolveResumeModel`);claude/codex/opencode 支持 effort — `provider-capabilities.service.ts`
- **Slash commands**:扫 `.claude/commands/` + `~/.claude/commands/`,解析 frontmatter,内置命令兜底 — `server/routes/commands.js:439-457`
- **Skills 管理**:四 provider 各有 skills.provider,支持列出/写入/删除全局 skills — `server/modules/providers/services/skills.service.ts`
- **插件系统**:从 git repo 装插件到 `~/.claude-code-ui/plugins`,manifest 校验,可加前端 tab、起后端进程并经 `/plugin-ws/*` 代理 WS — `server/utils/plugin-loader.js:7`、`plugin-process-manager.js`、`plugin-websocket-proxy.service.ts`
- **Headless Agent REST API**:`POST /api/agent`(API key 认证)对 GitHub URL 或本地路径跑任意 provider,自动建分支、完成后**自动开 PR**(Octokit);带独立 API 文档页 — `server/routes/agent.js`、`public/api-docs.html:577`
- **Browser Use**:服务端管理浏览器会话(截图 JPEG base64 回传、click/navigate),注册成 MCP server 供 agent 调用;可选 `nut-tree` 桌面截屏 — `server/modules/browser-use/browser-use.service.ts:387-389,462`
- **TaskMaster AI 集成**:检测 `.taskmaster/`、spawn `task-master` CLI、看板(TaskBoard/TaskCard/筛选排序)、**PRD 编辑器**(写 PRD → 生成任务)— `server/routes/taskmaster.js`(1470 行)、`src/components/task-master/`、`src/components/prd-editor/`
- **项目管理**:项目创建向导(GitHub clone + token + SSE 进度)、项目重命名/星标/删除 — `server/modules/projects/services/project-clone.service.ts`、`projects.routes.ts:156,230`
- **Docker 沙箱**:`cloudcli sandbox <workspace>` 起 `cloudcliai/sandbox:claude-code|codex` 镜像跑隔离环境 — `server/cli.js:257`、`docker/`
- **i18n 10 种语言**(de/en/fr/it/ja/ko/ru/tr/zh-CN/zh-TW)— `src/i18n/locales/`
- Onboarding 向导(agent 连接检测 + git 配置)— `src/components/onboarding/`

## 二、技术栈总结

| 层 | 选型 |
|---|---|
| 前端 | React 18 + Vite 7 + Tailwind 3 + react-router;状态:zustand(`useSessionStore.ts`)+ Context;i18next;cmdk;CodeMirror 6;xterm;react-markdown + KaTeX |
| 后端 | Node + Express 4(JS 与 TS 混写,tsx 跑 dev、tsc 出 dist-server),模块化 `server/modules/*`(routes/services/repositories 分层) |
| 数据库 | better-sqlite3,单文件 `~/.cloudcli/auth.db`(用户、API key、GitHub token、会话索引、项目、推送订阅、通知偏好等十余表)— `server/modules/database/` |
| 传输 | 纯 WebSocket(`ws`),path 分流;REST 承载历史/管理;SSE 仅用于搜索与 clone 进度 |
| Agent 集成 | claude Agent SDK(进程内)/ codex SDK / cursor CLI stream-json / opencode run 每回合 spawn |
| 分发 | npm 包(`npx @cloudcli-ai/cloudcli`)、Docker、Electron 桌面、付费云(cloudcli.ai) |
| 测试 | node:test 风格的 *.test.ts 散布各模块(约 30 个文件),无 e2e |

架构本质:**server 与 agent CLI 同机**,浏览器直连该 server。没有 relay/隧道;远程访问要自己暴露端口或用他们的云。

## 三、对比一:两边都有、但对方实现更好的

1. **历史会话:四 provider 全量索引 vs 我们仅 claude listSessions**
   它给每个 provider 写了落盘格式解析器(claude jsonl / codex rollout jsonl / cursor store.db / opencode.db),统一进 SQLite,chokidar 实时增量,配套重命名、归档/恢复、删除、分页历史、跨会话 ripgrep 全文搜索(证据见上 §2)。我们只有 claude 的 listSessions(`apps/bridge-cli/src/adapters/claude-code-list-sessions.test.ts`),codex 有 thread/resume 但无历史列表,opencode/pi 没有。这是体验差距最大的一块。

2. **断线重连:seq 精确重放 + pending 审批重投**
   `chat-run-registry.service.ts:29-63` 每 run 缓冲带 seq 的事件(上限 5000、完成后留 5 分钟),`chat.subscribe` 带 `lastSeq` 只补漏掉的;且订阅响应里附带 `pendingPermissions`(`chat-websocket.service.ts:299-315`),页面刷新后等待中的审批卡原样恢复。我们的 SSE 自动恢复 + 增量折叠解决了"续流",但没有 per-run seq 语义,审批卡在刷新后依赖服务端状态重建,不如它这个协议干净。

3. **工具渲染的集中式注册表**
   `toolConfigs.ts`(530 行)把每个工具的展示形态(one-line/collapsible/plan/hidden)、取值函数、动作(copy/open-file/jump-to-results)、配色全部声明式集中;审批面板同样走 `permissionPanelRegistry.ts` 按工具名注册。我们的 ActivityItem/bridge-tool-card 是分散实现,新工具接入成本更高。它的模式值得借鉴(注册表 + 渲染器分离)。

4. **subagent 工具分组**
   SDK 的 `parent_tool_use_id` 被显式透传(`claude-sdk.js:282-289`)并在前端折叠成 `SubagentContainer`(子工具进度、当前工具索引、完成态)。我们的 `bridge-turns-tool-task.ts` 有 task 分组雏形,但没有按父子 id 把 subagent 的整条子工具流折叠进一张卡。

5. **忙时排队的跨会话自动派发**
   我们的 send{queue} 只服务当前会话;它对**未打开的会话**也会在 run 结束时自动发出排队稿(`useQueuedMessageAutoSend.ts:21-26`),多会话并行开工时体验更顺。

## 四、对比二:对方有、我们没有的

按对我们用户的价值粗排:

1. **图片输入**(四 provider 全支持,含安全过滤与 claude content-block 注入)— §1/§3 证据
2. **文件浏览器 + CodeMirror 编辑器**(含上传、图片预览、markdown 预览)— `src/components/file-tree/`、`src/components/code-editor/`
3. **git 面板全家桶**(22 端点 + AI commit message + 提交图谱)— `server/routes/git.js`
4. **内置终端**(node-pty + xterm,真实 shell)— `shell-websocket.service.ts`
5. **Web Push + 桌面通知**(审批等待/完成/失败推送到手机锁屏)— `notification-orchestrator.js`、`useWebPush.ts`
6. **跨会话全文搜索 + 命令面板** — ripgrep + cmdk
7. **会话重命名/归档/恢复/删除**(我们清单里也自认未实现 fork/重命名)
8. **语音输入/TTS**(OpenAI 兼容后端代理,~224 行)— `voice-proxy.js`
9. **Cursor agent 支持**(我们没有;对等地我们有 pi 它没有)
10. **Headless REST API**(API key 跑 agent、自动开 PR)— `routes/agent.js`
11. **PWA + i18n(10 语)+ Electron 桌面 App + Docker 沙箱**
12. **插件系统**(git 装插件、加 tab、后端进程 WS 代理)
13. **Browser Use**(服务端浏览器会话做成 MCP 给 agent 用)、**TaskMaster 看板 + PRD 编辑器**、**项目创建向导(GitHub clone)**

## 五、对比三:我们有、对方没有的(差异化优势)

- **云端 SaaS 多用户 + relay 架构**:它是单用户(`auth.js:44` 明文写死)、server 必须与 CLI 同机;我们网页在云上、`agent-cli` 在用户本机,经 relay WS 双工 + HTTP 轮询降级,天然支持随处访问与多用户注册/token/用量 dashboard。这是产品形态级差异,也是它收费云(cloudcli.ai)在卖的东西。
- **codex/opencode/pi 的交互式审批**:它的能力矩阵里只有 claude `supportsPermissionRequests: true`,codex 被映射成 `approvalPolicy: 'never'|'untrusted'` 静默放行/拒绝;我们有 codex approval+sandbox、opencode QuestionCard、pi extension_ui 表单卡,审批覆盖面显著更广。
- **pi agent 适配 + opencode serve 常驻**(HTTP+SSE):它 opencode 是每回合 spawn `opencode run` 的一次性进程,无法 steer、事件粒度受限。
- **忙时输入策略 send{now/queue/steer/followUp}**,pi 原生 steer;它只有 queue。
- **账号配额面板**(claude oauth/usage、codex wham/usage)+ context 迷你条 + 会话统计;它只有基于消息 usage 的 token 条(context window 还是 env 猜的 160k)。
- **动态能力握手**(`session_ready.capabilities`,agent 运行时上报)vs 它的静态硬编码矩阵 — 我们加 agent/加能力不用改前端矩阵。
- **CUA 远程控制**(VNC 看 agent 操作 VM 桌面)——它的 Browser Use 只是给 agent 的 MCP 工具,方向不同。
- **回合脊线 TurnBlock UI**、ApprovalCard v2(acceptForSession/fileChange 摘要/倒计时)、Skills 端到端安装、MCP live 管理。

## 六、对我们的改进建议(按价值/成本排序)

| # | 建议 | 价值 | 成本 | 说明 |
|---|---|---|---|---|
| 1 | **图片输入** | 高 | 中 | 移动端拍屏幕截图发给 agent 是高频刚需。可照抄它的三段式:上传到受控 assets 目录(`filterImagesToUploadStore` 的直接子文件校验值得照搬,`chat-websocket.service.ts:26-45`)→ relay 传描述符 → claude 走 SDK content block(`claude-sdk.js:377-394`),codex/opencode 有各自的 image 输入形态(`shared/image-attachments.ts` 全有参考实现)。我们多一跳 relay,需要在 bridge-cli 侧落文件。 |
| 2 | **全 provider 历史会话索引 + 会话管理** | 高 | 中 | 它证明了 codex rollout jsonl、opencode.db 都可解析(现成解析器可参考 `codex-sessions.provider.ts`、`opencode-sessions.provider.ts`)。在 bridge-cli 侧实现 listSessions 的 codex/opencode 版 + 重命名/归档,补齐我们"仅 claude listSessions"的短板。 |
| 3 | **重连协议 seq 化 + pending 审批随订阅重投** | 高 | 低 | 在现有 SSE 恢复上加 per-run 单调 seq 与有限缓冲(它 5000 条/5 分钟的参数可直接用),订阅 ack 附带 pending 审批。移动端切后台回来的体验会明显变好。 |
| 4 | **Web Push 通知** | 高 | 低-中 | 我们网页本来就在云上,做 push 比它还顺(不需要它那套自签 VAPID 起服务的本地流程)。核心场景:审批等待、run 完成。参考 `notification-orchestrator.js` 的事件分类(action_required/run_stopped/run_failed + dedupeKey)。 |
| 5 | **工具渲染注册表化** | 中 | 低 | 把 bridge 工具卡迁到声明式 TOOL_CONFIGS 模式 + 按工具注册审批面板,降低新 agent/新工具接入成本(参考 `toolConfigs.ts`、`permissionPanelRegistry.ts`)。顺手补 subagent 父子分组(claude 事件里 `parent_tool_use_id` 我们已经拿得到)。 |
| 6 | **跨会话搜索** | 中 | 中 | ripgrep 扫转录在 bridge-cli 本机跑很自然(我们不需要 runCommand 通道,做成 bridge RPC 即可),结果经 relay 流回。参考 `session-conversations-search.service.ts` 的 snippet+高亮合并逻辑。 |
| 7 | **只读 git 面板起步(status + diff)** | 中 | 中 | 它 1634 行 git.js 证明全功能面板成本不低;但 status/diff/commits 三个只读端点(`git.js:367,409,913`)走 bridge RPC 成本可控,和我们的内联 diff 互补。stage/commit/push 二期再说。 |
| 8 | **语音输入** | 中 | 低 | `voice-proxy.js` 全文 224 行,OpenAI 兼容 STT 代理 + MediaRecorder 前端,几乎可以直接移植;对移动端场景加分。 |
| 9 | 内置终端 / 文件编辑器 | 低-中 | 高 | node-pty 过 relay 意味着把远程 shell 暴露到云端网页,安全模型和我们多用户 SaaS 冲突,需要单独的授权设计;文件编辑器同理。除非用户强需求,否则不优先。 |
| 10 | TaskMaster / 插件系统 / Electron | 低 | 高 | 与我们的产品方向(远程驾驶 agent)重合度低,不建议跟进。 |

---

*调研方法备注:本文所有断言基于对上述 commit 源码的直接阅读;行号以该 commit 为准。未运行该项目,少数运行时行为(如 Windows 兼容细节)未实测。*

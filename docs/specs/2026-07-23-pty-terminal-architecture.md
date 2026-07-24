# Better Agent — PTY 终端架构（完全重构）

日期：2026-07-23
状态：架构定案，待拆分实施
决定：**彻底重构 local agent。删除现有"解析 stream + 自定义中继 + 重渲染工具卡"整套；改为 PTY 透传（原生 TUI 跑在 PTY 里，xterm.js 传字节）。** 前端性能必须对标原生终端——否则本重构无意义。

## 1. 目标与非目标

### 目标
1. **交互对标原生**：web 里的终端与本机直接跑 `claude` 体验一致——同样的画面、同样的流畅度、同样的延迟量级。前端性能是硬指标。
2. **对 Claude Code 版本免疫**：不再解析其内部输出。它升级、加工具、改协议——我们零改动。
3. **一套代码覆盖所有 runtime**：claude/codex/opencode/pi 都有 TUI，PTY 透传对它们同一套，删除全部 per-runtime 解析。
4. **多机共享标准化**：Profile（skill/MCP/规范/模板）统一管理，CLI 落地到各机器；作用域化共享记忆。
5. **关页面不丢**：tmux 式 detach/reattach；detach 后经 hook/进程信号在 dashboard 看粗粒度状态。

### 非目标（本期不做）
- 结构化工具卡/按钮式审批的 web 富渲染（审批在终端里原生操作）。
- 可搜索的完整结构化历史（终端只保留有界滚屏；需要留档另配本地日志，见 §9）。
- 多用户协作 ACL（读写权限/审计）——留到协作阶段。

## 2. 现状病根（为什么必须整体删）

当前一条**脆弱通道**同时扛"画面"和"状态"：解析 Claude Code 的 stream-json → 归一化 → fold turns → 20+ React 卡片 → shiki 高亮 → 自定义中继。三个结构性问题：
- 依赖不稳定内部协议 → 版本兼容永远追不完（resume/子agent/model/工具卡缺失全是这个病）。
- React 逐消息重渲染 + shiki + 无界事件数组 → "Aw Snap" OOM 与"输出慢"。
- 每 session 一条自定义连接 + 自定义缓冲/背压/截断 → 丢包/延迟一整类 bug。

PTY 用**两条稳定通道**替代：**PTY 透传 = 画面**（版本无关），**进程信号 + hook = 状态**（版本无关）。二者都不"看懂"Claude Code 输出。

## 3. 总体架构

```
┌─ 你的电脑 ────────────────────────────┐        ┌─ 服务器(Docker) ─┐      ┌─ 浏览器 ─────────┐
│ agent-cli 守护进程                      │        │                  │      │                  │
│  ├ PTY 管理: 每 session 一个 pty 子进程 │  一条   │ 多路复用中继      │ WSS  │ xterm.js         │
│  │   (claude/codex/... 原生 TUI)        │◄─多路──►│ (纯字节透传,     │◄───►│  WebGL 渲染      │
│  ├ 滚屏环形缓冲(有界,可落盘)           │  复用   │  不解析/不落库)   │ 二进制│  (热路径不过 React)│
│  ├ 帧合并 + 流控(背压)                 │  WSS    │                  │ 帧    │                  │
│  ├ hook 接收器(生命周期状态)           │────────►│ 粗状态存储        │─────►│ Dashboard(粗状态) │
│  ├ Profile 同步(落地文件)              │◄────────│ Profile 源(版本)  │      │ Profile 管理 UI   │
│  └ memory MCP 调用 ──────────────────────HTTP───►│ Memory(作用域)    │◄───►│ Memory 管理 UI    │
└───────────────────────────────────────┘        └──────────────────┘      └──────────────────┘
```

三个组件的职责：
- **CLI 守护进程**：拥有 PTY 子进程、滚屏、流控、hook 接收、Profile 落地、memory MCP 走向服务器。是唯一"贴着 agent"的东西。
- **服务器**：字节透传的多路复用中继（不解析、不持久化终端字节）；Computer/session 认证；Profile 源 + 版本；memory MCP 端点（作用域）；粗状态存储（供 dashboard）。
- **Web**：xterm.js WebGL 终端（热路径绕开 React）；session dashboard；Profile/Memory 管理界面。

## 4. 前端性能设计（核心，对标 native）

> 现状 OOM/慢的根因是"每字节过 React + shiki + 无界数组"。PTY 方案的全部性能都建立在**把终端数据路径完全移出 React**之上。

### 4.1 渲染：xterm.js + WebGL
- **`@xterm/xterm` + `@xterm/addon-webgl`**：GPU 加速渲染，与 VS Code 集成终端同级。Canvas addon 作降级。这是达到 native 流畅度的**单一最关键选择**。
- **热路径零 React**：终端数据 → `term.write(bytes)`，**完全不经过 React 渲染/reconcile**。React 只管外壳（标签页、侧栏、dashboard），**绝不**在终端字节到达时重渲染。xterm 自己持有一块 canvas，React 从不碰它。这条铁律是 native 级性能的根本——违反它就退回现在的病。
- **有界滚屏**：xterm 内建 scrollback ring（如 10k 行），高效、native 等价；我们**不**在 JS 里维护会增长的数组。

### 4.2 传输：二进制帧，不是 JSON
- 终端字节是二进制 → 用**二进制 WS 消息**（ArrayBuffer）承载，直接喂 `term.write()`。**绝不** base64-in-JSON（膨胀 33% + 编解码开销）。
- 帧头极简：`[sessionId(可变长) | type(1B) | payload]`，多路复用用（§5）。

### 4.3 帧合并（producer 侧）
- CLI 把 PTY 输出**按 ~一帧窗口(8–16ms)合并**再发，浏览器每帧最多一次 `write`。避免逐字节 write 抖动，也压掉 TUI 原地重绘的碎片。
- xterm 侧亦可用 `write` 的批处理；两端配合达到"一帧一画"。

### 4.4 流控 / 背压（防 OOM + 防"慢"的关键）
- **xterm flow control**：`write(data, callback)` 的 callback 表示已消费；用**滑动窗口 ack** 给 producer 反压——浏览器落后时，CLI **暂停读取 PTY**（PTY 有 tty 级原生流控，暂停 read 即让 agent 输出自然阻塞）。
- 效果：无界缓冲不存在了（现状 OOM/lag 的直接死因）。浏览器永远不会被喂爆；生产端自然被拖慢到浏览器能跟上的速率——这正是原生终端在你机器上的行为。

### 4.5 多 session 的前端预算
- **只有可见/活跃的终端全速渲染**。后台 session 的字节流**限速或暂停**（后台只需粗状态即可，见 §10），切过去时再恢复全速 + 重放滚屏。
- 于是 100 个并发 session **不会**让前端有 100 份全速渲染负担——前端只为你正在看的那个付全价。

### 4.6 reattach 的重放
- CLI 守护进程持有**权威滚屏**（有界 ring，可落盘）。reattach 时**一次性 bulk write** 该滚屏（xterm 处理大块写很快），再转 live。不是逐条重放。
- 服务器**不存**终端字节（透传即弃），滚屏在你本地——既省服务器、又减少密钥落盘（§11）。

### 4.7 性能验收标准（可测，作为"对标 native"的闸）
- **吞吐**：`cat` 一个大文件 / `yes` 洪流,终端流畅滚动,**标签页内存不随输出增长**（受 xterm 有界滚屏约束，稳定在几十 MB 量级）。
- **无 OOM**：连续 stream ≥100MB 输出,标签页不崩、内存不失控。
- **输入延迟**：击键→回显 ≈ native + 一个网络 RTT；本地网络下人感无差异。
- **多 session**：≥20 个 session 并发挂着,前端只有可见那个全速,总内存有界。
- **重绘密集**：spinner/进度条不卡顿（帧合并生效）。
- 任一项达不到 native 感受 = 不通过,回炉调 4.1–4.5。

## 5. 传输层：每台电脑一条多路复用连接（hub）

- **一台 Computer 一条 WSS**（不是每 session 一条），所有 session 的字节流在这条上**按 sessionId 分帧**多路复用。解决现状"N session = N+1 连接、N 套缓冲"的问题（也是你直觉到的 hub）。
- 帧类型：`data`(终端字节,双向)、`resize`(winsize)、`open`/`close`(session 生命周期)、`ack`(流控窗口)、`state`(hook 状态,§10)。
- 认证：复用 Computer 的 Ed25519 签名握手（现有 computerProcedure 那套）。整条连接一次认证,帧内 sessionId 授权归属该用户。
- 降级：WS 断线指数退避重连;重连后按每 session 的滚屏游标续传(CLI 侧滚屏是权威,续传只补 delta)。**输入**走可靠小帧(带序号,重连补发)。

## 6. CLI 守护进程

- **PTY 管理**：每 session `node-pty`(或等价)fork 一个 pty,在其中跑选定 runtime 的**原生 TUI**（`claude` 等,不是 SDK headless）。winsize 跟随前端 xterm 尺寸(resize 帧 → SIGWINCH)。
- **滚屏**：每 session 有界 ring buffer(如最近 N KB/行),可落盘,供 reattach 与重连续传。
- **帧合并 + 流控**：§4.3/4.4 的 producer 侧。
- **detach/reattach**：前端断开 = detach,pty 子进程照常跑;前端回来 = reattach + 重放滚屏。**关页面不杀进程**。
- **hook 接收器**：本地起一个小端点接收 Claude Code hook 回调(§10),转成 `state` 帧上报。
- **Profile 同步**：`sync` 命令拉 Profile 落地到 `~/.claude/` 与项目层(§8),幂等、托管块、不覆盖用户私货。
- **保留能力**：Computer 身份/配对/心跳/inventory、Project clone/worktree/query(这些是通用基建,不属于被删的解析层)。

## 7. 服务器

- **多路复用中继**：字节透传的双工管道,**不解析、不逐事件落库**。比现状的 ingest+persist+SSE 轻一个量级。
- **认证与隔离**：Computer 密钥对、session 按用户隔离(复用现有)。
- **不持久化终端字节**：透传即弃(滚屏在 CLI 本地)。安全上比现状(bridge_messages 存工具输出=含密钥)更好(§11)。
- **粗状态存储**：从 hook/进程信号收到的 session 状态(running/waiting/done/failed/idle),供 dashboard。小、结构化、稳定。
- **Profile 源 + 版本**：§8。**Memory MCP 端点**:§9。

## 8. Profile 标准化层（skill / MCP / 规范 / 项目模板）

服务器一个 **Profile**(个人一份,将来团队一份),**唯一事实源、带版本**,web 统一编辑。CLI `sync` 落地成 **Claude Code 读取的文件**(稳定契约,不碰易变协议):

| 内容 | 管理入口(web) | 落地位置(CLI 写) | 生效范围 |
|---|---|---|---|
| Skills | Skills 页 | `~/.claude/skills/<name>/SKILL.md` | 全局(所有项目) |
| MCP servers | Integrations 页 | `~/.claude/settings.json` mcpServers / `.mcp.json` | 全局 |
| 开发规范(常驻规则) | Standards 页(新) | `~/.claude/CLAUDE.md`(托管块) | 全局 |
| 项目模板 | Templates 页(新) | 选模板时铺目录 + 项目层 `.claude/`/CLAUDE.md/`.mcp.json` | 项目 |

- **分层**：通用的放**全局层** → 新项目零初始化就继承全套规范("不用每起项目初始化一次")；模板只补项目特有增量。
- **版本**：改 Profile → 版本+1 → 各机器下次 sync 重新落地。CLI 记录已落版本。
- **幂等/不覆盖**：托管块策略(`# BEGIN managed ... END`),profile 段与用户手写并存。
- **现成零件**：skills 表/页/落地、mcp_servers/resolve、memory——现在按 session/token 散用,重聚到"Profile → 全局落地"。

### 规则的硬拦截(关键规范可升级)
"绝不"级规则(如"改 DB 对象必出迁移脚本")除写进 CLAUDE.md,可配 **PreToolUse/PostToolUse hook** 做确定性检查/拦截,而非靠 agent 自觉。hook 与 §10 观测同一套机制,一物两用。

## 9. 作用域化共享记忆

- **机制**：记忆 = 我们的 **memory MCP server**(现有 memory-mcp),经 Profile 落地进每台机器 `~/.claude/` MCP 配置。终端里"记住 X" → agent 调 `memory_add` → **直接写我们服务器**(写=同步,即时)。**与交互方式、Claude Code 版本无关**——原生终端里也成立。
- **读**：其它机器/项目的 agent `memory_search` 读同一服务器库;可配 SessionStart hook/规则"开工先拉相关记忆",让其它 agent 主动带着记忆开工。
- **作用域(要害)**：记忆带 `scope: global | project`。**会话携带项目身份**(CLI 起项目 session 时给 memory MCP 连接配带项目标识的作用域 token)。
  - 写:项目内**默认 project 作用域**(安全默认,项目记忆不外泄);明说"全局"才写 global。
  - 读:返回 **global + 当前项目**;看不到别项目私有记忆。
  - standalone(无项目):默认 global。
- **可管**：web Memories 页浏览/改作用域(项目↔全局提升降级)/删除。自动记的东西人可复核纠正。
- **一条规则**(Profile Standards):"用户说记住时调 memory_add;项目特定信息用 project 作用域,通用偏好用 global。"让"记住 X"稳定路由 + 选对作用域。

## 10. 可观测（detach 后看状态，不解析终端）

三个**终端外**的稳定信号,合成 dashboard 粗状态:
1. **进程存活 + 退出码**(CLI 拥有子进程,100% 可靠)→ 运行中/已结束(成功/失败)。
2. **字节流活跃度**(看是否在吐字节,不看内容)→ 工作中/空闲。
3. **Claude Code hooks**(SessionStart/Stop/Notification/PreToolUse/SubagentStop/SessionEnd 等,**稳定扩展点**)→ 开始/turn 完成/需审批/等输入/结束。CLI 接收 → `state` 帧上报服务器。

dashboard 跨机每 session 一行:`电脑·runtime·项目 | 状态 | 最近活跃`。全部来自上述三信号,**零终端解析**,故版本免疫。细看点进去 reattach PTY。

## 11. 安全模型

- **不新增攻击面**:现状 web 本来就能 sendInput 驱动 agent 跑命令;PTY 只换管子,能力边界不变。
- **复用现有认证**:Computer 密钥对、session 按用户隔离;PTY attach/输入走同一认证通道。
- **反而更好**:服务器**不持久化终端字节**(滚屏留本地) → 密钥落盘比现状(bridge_messages 存工具输出)更少。链路 Caddy HTTPS。
- **xterm.js 硬化**:对危险 ANSI 转义序列有防护(VS Code 在用);只把字节喂 xterm,不喂别处。
- **两个必须认的前提**:
  1. **bypassPermissions + 可 attach = 组合放大**:全自动 allow 关掉 agent 审批,谁能碰 session 谁就能让 agent 无提示跑任何命令 → "谁能访问 session"成唯一闸。自托管单用户可接受,但心里有数。
  2. **多用户协作要补 ACL**:将来别人能 attach 共享/他人机器 session 时,必须有只读 vs 可写 attach、单写者锁、输入审计。协作阶段做,第一阶段不碰。

## 12. 删除 / 保留（精确面见附录 A，由代码盘点补全）

**删除(整套解析+中继+重渲染)**：
- CLI：`normalize/` 全部;`adapters/` 的事件规范化部分;`forward-events*`/`truncate-*`/`push-queue*`/`ws-duplex`(结构化帧)/`relay-client`/`run-bridge-session*`/`restart-loop`/`session-watchdog*`。
- Web：`components/bridge/` 的全部工具卡/turn/fold/event-feed/自定义 terminal 渲染/send-outbox;`components/tasks/` 的 conversation/chat/sidebar 渲染。
- Server/api：bridge 结构化事件 router、ingest-events、persist-retry、stream、bridge-size-limits、`bridge_messages` 表(弃用)。

**保留/改造**：
- Computer 身份/配对/心跳/inventory(通用基建)。
- Project clone/worktree/query(§6 复用);task/run 模型**简化为"PTY session"**(去掉围绕结构化事件的部分,见附录 A 灰色地带结论)。
- Skills/MCP/Memory(升为 Profile 核心);三个 MCP app、authz 等无关部分。
- 双工连接基建(`bridge-ws`/`redis-relay-store`)**改造复用**为 §5 的多路复用字节中继(而非重写)。

## 13. 分阶段交付

**阶段 1 — Profile + 作用域记忆(可立即开始,不依赖 PTY,robust)**
- Profile 数据模型 + 版本;Standards/Templates 页;CLI `sync` 落地(skill/MCP/CLAUDE.md/模板)。
- memory MCP 作用域化(global|project) + 会话项目绑定 + web 管理。
- 交付即见效:多机共享规范、零重复初始化、统一记忆。**几乎不引入新 bug。**

**阶段 2 — PTY 终端(核心重构,删旧 local agent)**
- CLI：PTY 守护(node-pty)、滚屏、帧合并、流控、detach/reattach。
- Server：§5 多路复用字节中继(改造 bridge-ws/relay-store),去结构化事件持久化。
- Web：xterm.js + WebGL,热路径零 React;多 session 前端预算(§4.5);reattach 重放。
- **删除** §12 的整套解析/中继/渲染。
- 闸:§4.7 性能验收全过(对标 native),否则不合并。

**阶段 3 — 可观测 dashboard**
- Claude Code hooks(Profile 落地)→ CLI `state` 帧 → 服务器粗状态 → 跨机 dashboard。

**阶段 4 — 协作(later)**
- 多用户 ACL、只读/可写 attach、输入审计。

## 14. 风险与开放问题

- ~~**node-pty 在 bun 编译产物里的原生绑定**~~ **已验证并定案（spike `08b1e71`，`docs/research/2026-07-23-node-pty-bun-spike.md`）**：node-pty 在 Bun 下**完全不可用**（tty 读不出 pty master、`.node` 打不进单二进制），FFI forkpty 段错误、`bun:ffi` 不支持 ioctl 变参无法 resize。**定案方案**：内嵌一个 ~50KB 原生 C **pty-broker**（forkpty 持有 pty、数据走普通管道、resize 走控制 fd 在 C 里 ioctl）——已端到端验证：单二进制编译、无依赖运行、双向数据 / resize / SIGWINCH / 退出码 / 干净 kill 全通过，**对单二进制分发零影响**（CI 加一步为 4 target 交叉编译这个无依赖 C 小程序并内嵌）。约 2.5–3 人日。阶段 2 的 pty 层按此实现。
- **重绘密集 TUI 的带宽**:帧合并压掉多数;慢网下极端刷屏仍可能抖,可加"降帧率"档。
- **审批体验**:审批在终端内原生操作(不是按钮);dashboard 显示"等审批"状态提示你回去。可接受度待真机体验。
- **完整历史留档**:终端只留滚屏;若需可搜索历史,CLI 本地把 hook 事件/`stream-json` 写本地日志留档(不参与渲染)——阶段 3 可选。
- **task/run 概念的去留**:PTY session 是否还需要 run(顺序执行)、launch 幂等、workspace 准备——倾向保留 workspace 准备(project clone)+ 简化的 session 生命周期,去掉围绕结构化事件的 run 机制。附录 A 盘点后定案。

## 附录 A：代码盘点（删除面/保留面精确清单）

来源：全仓只读盘点。当前链路 = `web → server(oRPC+WS/SSE) → 每 session 中继(Redis 窗口 + bridge_messages) → CLI(computer-client + task-launch) → adapter 驱动 SDK 子进程 → normalize 成 NormalizedEvent → forward-events 中继 → 20+ web 工具卡`。adapter 层干两件事——**驱动 SDK 子进程** + **把流归一化成 NormalizedEvent**;PTY 把两者一起换掉。

### A.1 删除面（整套解析 + 中继 + 重渲染）

**CLI（apps/bridge-cli/src）**
- `normalize/`：全部 22 个非测试文件(~3,060 行)——四个 runtime 的 stream 解析,PTY 一个都不需要。核心是 `normalize/types.ts` 的 `NormalizedEvent` 联合(整条结构化流水线存在的理由)。
- `adapters/`：~55/61 文件(~7,500 行)——各 runtime 的 SDK 驱动 + 事件/状态/审批/提问归一化 + 控制映射(`types.ts` 的 Adapter/AgentHandle 契约、agent/session-capabilities、claude-code*/codex*/opencode*/pi* 全家、approvals/questions/quota)。
- 事件中继(~30 文件,~3,525 行)：`forward-events*`、`truncate-event/fields/status-shrink`、`push-queue*`、`poll-loop`、`oob-push`、`relay-client`、`relay-transport`、`run-bridge-session*`、`session-watchdog*`、`turn-stale`、`command-dispatch`/`command-*`/`commands*`(入站命令 → PTY 里变成裸击键)。

**Web（apps/web/src/components/bridge + tasks）**——bridge/ 共 173 非测试文件(~22,600 行),删 ~110/173：
- 工具卡 + activity 渲染：`bridge-tool-card*`、`tool-*`、`mcp-tool-card`、`web-*-card`、`report-findings-card`、`task-tool-card`、`bash-command-card`、`todo-list`、`activity-*`、`assistant-turn-block`、`plan-approval-card`、`question-card*`、`event-line/feed`。
- turn/feed 模型：`bridge-turns*`、`bridge-turn-types`、`fold-cursor*`、`session-ready-fold`、`bridge-events`、各 `bridge-*status*`、`bridge-chat-row`。
- **现有自定义"假终端"渲染器**(不是 PTY!)：`terminal*.tsx` 全家(body/feed/header/controls/composer*/status)、`status-line`、`send-outbox*`、`use-bridge-feed*`、`use-bridge-terminal*`、`sse-client/parser`、`use-sse-connection`。→ 整体被 xterm.js 替换。
- tasks/ 结构化渲染：`task-chat`、`task-conversation*`、`opening-message-row`、`past-run-history`。

**Server / api**
- `packages/api/src/bridge/`：`ingest-events`、`persist-retry`、`stream`、`command-bus`、`pending-requests`、`read-attention`、`session-attention`、`push-notify`。
- bridge routers：`bridge-push-events`、`bridge-send-input`、`bridge-size-limits`、`bridge-idempotency`、`bridge-run-binding`、`bridge-agent-session-id`、`bridge-session-info`、`turn-channel` 等纯结构化事件服务。
- `apps/server/src/bridge-stream-run`。
- DB：`bridge_messages` 表 + `bridge-message-store`(结构化事件持久化,PTY 不需要)。

### A.2 改造/复用（不是删,是换 payload）
- **多路复用中继机制**：`redis-relay-store.ts`(seq/窗口/TTL/幂等/重连重放)、`ws-session.ts`(帧协议 + 连接状态机)、`ws-duplex*`(reconnect/backoff/socket)、`bridge-ws.ts`——这些"断线重连 + 重放窗口"的机制**正是 PTY 字节流 reattach 需要的**。保留机制,**把事件帧换成字节帧**。
- CLI `task-launch/`：`launch-wiring`/`launch-handler`/`run-session`/`control-ws`/`start-context` 改成"PTY 里起原生 TUI + 接字节传输";`adapters/process-io`(PATH 发现)、`AGENT_CLI`(binary/install 表)保留数据、去掉 selectAdapter。
- Web 外壳：`local-agent-workspace*`、`session-workspace-pane`、`workspace-drawer` **换掉终端 tab 为 xterm**,列表/配置/导航保留。

### A.3 明确保留（通用基建 / 其它功能）
- Computer 身份/配对/心跳/inventory/控制通道(launch command 仍走签名命令启动 PTY session)。
- Projects + clone + worktree + query(runtime 无关的 workspace 准备)。
- Skills / MCP / Memory(升为 Profile 核心;claude-code-skills 的落地文件保留)。
- 三个 MCP app、authz、finance;**云端 agent chat(sessions/messages,独立 LLM 聊天面,勿与 bridge_sessions 混)**。
- **CUA(Lume/VNC)**：盘点结论——**与 PTY 共存**。它是独立传输(noVNC WS 到 VM 桌面),不属于结构化事件流;cua session 和 pty session 是并列的 session 种类,唯一交点是都经同一 computer 控制通道启动 + 都在 bridgeSessions 上报 endpoint。不冲突,保留。

### A.4 灰色地带的定案（spec 层拍板）
1. **Run/Task 模型**：保留 `runs`/`tasks` 作为"启动 + workspace 记录"(launch 幂等、resume、历史),**删除事件派生的 status/reconcile**(`tasks-run-status`/`reconcile` 失去输入),**run 状态改由 PTY 进程存活重新定义**(§10)。
2. **Workspace 文件/Git/Shell 侧栏**(file-tree/git-*/shell pane + fs/git/shell channel)：概念上独立于 agent 流,是"workspace 代码浏览器",**保留为功能,但要换一条瘦 RPC 传输**(现在依赖被删的结构化命令通道)。作为 PTY 终端旁的辅助面。
3. **Session resume / 历史浏览**：可保留为"在 PTY 里 `--resume <id>`",但 `agentSessionId` 现在来自被删的 `session_ready`——PTY 需另寻 runtime session id(读磁盘 session 文件 / 从 TUI)。**阶段 2 定**。
4. **用量/配额统计**：现在从归一化状态事件刮取,PTY 只见字节 → **本地 agent 的 usage/quota 统计取消**(或从 runtime 侧文件刮取,阶段 3 可选)。cloud agent 的用量不受影响。
5. **重启/watchdog**：保留"崩溃重启"意图,**触发器改为进程退出 / 无输出超时**(不再是 turn 事件)。
6. `bridgeSessions` 残留列(`agentSessionId`/`lastModel`/`lastPermissionMode`)：保留表、弃用这些列。

### A.5 删除体量

| 桶 | 非测试文件 | 非测试行数 |
|---|---|---|
| CLI normalize/ | 22 | ~3,060 |
| CLI adapters/(~90%) | ~55 | ~7,500 |
| CLI 事件中继/命令 | ~30 | ~3,525 |
| Web bridge/+tasks 渲染(~60-70%) | ~110 | ~14,000–16,000 |
| Server/api bridge(~60%) | ~25 | ~1,800 |
| DB bridge_messages + store | 2 | ~200 |

**净删除约 220–240 个源文件、~30,000–33,000 行非测试代码**(CLI≈14k / Web≈15k / Server≈2k),连同同目录测试,移除足迹约 **400+ 文件、55,000–65,000 行**。其中"改造非删除"的部分(relay-store 机制、ws-session 状态机、ws-duplex 重连、workspace 侧栏、run/task 模型)是 §A.4 已定案的重用面。

关键契约文件(实施前必读)：`adapters/types.ts`(AgentHandle/Adapter 全契约)、`normalize/types.ts`(NormalizedEvent)、`schema/bridge.ts`、`api/src/bridge/ws-session.ts`(双工帧协议)、`server/src/redis-relay-store.ts`(中继窗口机制)。

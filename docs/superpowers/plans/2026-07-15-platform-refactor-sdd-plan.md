# Better Agent 平台重构总实施 Plan（SDD）

日期：2026-07-15
路线：全部重构（旧 bridge 模型迁移为 Computer/Task/Run，不做并存过渡）
范围：master spec §22 第一版闭环 = Slice 1 → 2 → 2.5 → 3 → 4。Slice 5（PR delivery）/ Slice 6（多 Agent）不在本 plan。

权威文档（冲突时以此顺序为准）：
1. `docs/specs/2026-07-15-better-agent-platform-master-spec.md`（2026-07-15 修订版，含密钥对身份、worktree 定案、依赖复用推迟、Slice 2.5、PAT、per-Run 快照、skill 能力握手、draft status）
2. `docs/specs/2026-07-15-new-task-wizard-and-agent-startup.md`（Slice 2–4 的行为与验收蓝本；其中 environment/setup-version 依赖失效层、Issue 快照归属 Task 两处已被 master spec 覆盖，作废）
3. `docs/superpowers/plans/2026-07-15-computer-first-better-agent-client.md`（Slice 1 底稿；其中 bridge-token-一对一身份与 bearer 认证已被 master spec §7.2 密钥对方案覆盖，作废）

## 全局约束（对每个任务生效）

- 工作分支 `dev`，每任务独立 commit（FF 合并语义，不 squash 跨任务）。
- Biome/ultracite + eslint 全绿：no `any`（用 unknown），for...of，template literals，early returns；eslint 复杂度上限 10、函数 ≤50 行；文件 ≤299 行（超了就拆）；describe 块 ≤50 行陷阱见记忆。`biome-ignore` 注释不会压 eslint，两者需各自处理。
- 魔法数字（-1/0/1 除外）必须命名常量。
- DB 变更走 `pnpm -F @better-agent/db db:generate`（下一迁移号 0043 起）+ `db:migrate`，禁止 db:push。
- Web 页面不加 page-header title/description 样板；对齐/间距/响应式/loading/error toast 按项目 UX 基线；tool 渲染零边框零 ring。
- 测试用仓库既有范式：Vitest、Testing Library、oRPC in-memory router client、adapter harness、fake fs/process、fake GitHub client。不引入 Browser E2E 框架。不跑 `gh auth status` 之类健康预检。
- 每任务完成标准：聚焦测试 + 所在包全量测试 + `pnpm check-types` 通过。

## 核心设计定案（子代理不得另行发明）

### D1. Computer 身份与认证（spec §7.2）
- Client 首次 pairing 时用 `node:crypto` 生成 **Ed25519** 密钥对。私钥 PEM 存本机 `~/.better-agent/identity.json`（`{ computerId, privateKeyPem, serverUrl }`，mode 0600）；Server 存公钥并签发 `computerId`。
- Pairing 流程：Web Computers 页 → "Pair new computer" → server 生成一次性 pairing code（`pc_` 前缀，sha256 入库，TTL 10 分钟，单次使用）→ 用户运行 `agent-cli --client --pair <code> --server <url>` → client 生成密钥对，调 `computers.pair { code, publicKeyPem, name, platform, arch, clientVersion }` → 返回 `{ computerId }` → 写 identity 文件。
- 后续请求签名认证：headers `x-ba-computer-id`、`x-ba-timestamp`（ms epoch）、`x-ba-signature` = Ed25519 签名 over `${timestamp}.${sha256hex(bodyJson)}`。Server 校验：computer 存在、签名验证通过、|now − timestamp| ≤ 5 分钟。抽成 `computerProcedure` 中间件（对照现有 `bridgeProcedure`）。
- 身份文件丢失 = 重新 pair = 新 Computer；不做认领。重复注册（同 computerId）只更新属性与 inventory。

### D2. Inventory（spec §6.1/§18.1）
- 探测顺序固定：`claude, opencode, codex, pi, git, gh`（PATH 存在性，绝无认证预检）。runtime→binary 映射来自 `AGENT_CLI[agentKind].binary`。
- `ComputerRuntimeInventoryItem { agentKind, skillCapability: "none" | "discoverable", skills: SkillSummary[] }`；`SkillSummary { name, description }`。
- v1 能力矩阵：claude-code = `discoverable`（扫描 `~/.claude/skills/*/SKILL.md`，解析 frontmatter name/description）；codex/opencode/pi = `none`。
- `ManagedToolInventoryItem { name: "git" | "gh", installed: boolean }`。
- 心跳常量：`COMPUTER_HEARTBEAT_INTERVAL_MS = 10_000`，`COMPUTER_OFFLINE_AFTER_MS = 30_000`；connected 由 server 按 `now - lastSeenAt` 计算，list 响应剥离敏感字段。

### D3. Task / Run 模型（spec §6.7–6.13）
- `tasks`：id、userId、name、description（原样，不可改写）、status `"draft" | "active" | "completed" | "archived"`（v1 创建即 active，draft 仅模型预留）、computerId、agentKind、repositoryFullName（可空）、repositoryUrl（可空）、openingMessage（text，创建时组装，永不改写）、createdAt/updatedAt。
- `runs`：id、taskId、computerId、agentKind、status `"created" | "launching" | "preparing_workspace" | "starting_runtime" | "running" | "waiting_for_user" | "failed" | "stopped" | "completed"`、launchKey（unique，幂等键 = runId）、workspaceKind `"repository" | "standalone"`、workspacePath（client 回报）、branch（可空）、issueSnapshots jsonb（`{ number, title, body, url }[]`，属 Run，启动时抓取）、sessionId（FK → bridge_sessions，可空，relay 绑定后回填）、errorMessage（真实错误，可空）、createdAt/updatedAt。
- Opening Message 模板 = master spec §10.1 原文；Task Start Context 组装切分 = wizard spec：Server 出标准部分（description + skill 引用未展开 + GitHub 块），Client 补 workspace 路径、工具事实并做 skill 解析。

### D4. Computer control channel 与 Launch（spec §9.1/§15.3）
- 主通道：client 以签名握手开 WS `GET /computer-ws?computerId=...&ts=...&sig=...`；server 经此推送 `{ kind: "launch", runId, payload }`，client 回 `{ kind: "ack", runId }`。
- 降级：heartbeat 响应携带 `pendingCommands`（server 记录未 ack 的 launch），保证无 WS 也能启动（≤10s 延迟）。
- 幂等：runId 即 launchKey。client 进程内维护 seen runId 集合；server 只对未 ack 的 run 重投。同一 runId 永不启动第二个 runtime 进程。
- Launch payload（§9.1）：`{ taskId, runId, agentKind, workspace: { kind, repository?: { fullName, cloneUrl, defaultBranch } }, description, issueSnapshots, skillReferences: string[], sessionCredential }`。
- **relay 复用定案**：server 在生成 Launch 时预创建 bridge session 凭据（复用现有 token 机制内部化，用户不再感知 token），payload 带 `sessionCredential`；client 启动 runtime 后用它接现有 session relay；`bridge_sessions` 加 `run_id` 列完成绑定。relay 协议、ws-duplex、restart loop 一律不动。

### D5. Workspace 与 Repository Cache（spec §6.16/§6.17/§9.2）
- Stand-alone：`~/.better-agent/tasks/<taskId>/` 干净目录。
- Repository cache：`~/.better-agent/cache/repos/<owner>__<repo>/`（bare clone）；Task Workspace = `git worktree add ~/.better-agent/tasks/<taskId>/repo -b task/<taskId 前 8 位> origin/<defaultBranch>`；cache 目录旁 `.lock` 文件锁（`wx` 创建 + 重试 + 陈旧锁超时 60s）串行化 clone/fetch。
- clone/fetch 用系统 git + 用户自己的凭据；失败即 Run failed + 真实错误（§16），不预检。
- 依赖复用不做（包管理器全局缓存兜底）。

### D6. Skill 解析（spec §6.6/§10.2）
- 单一 adapter 接口：`resolveSkillReference(ref: string): Promise<string | null>`；默认实现读 `~/.claude/skills/<name>/SKILL.md` 正文 inline 展开到 Description 中引用出现的位置；未知引用保持原文本。v1 仅 claude-code 实现，其余 runtime 因 capability none 不产生引用。
- Agent Environment Context 文案 = master spec §10.2 模板（git/gh installed 事实 + "authentication not preflighted"）。

### D7. GitHub Connection（spec §5.5）
- 表 `github_connections`：id、userId（unique）、credentialType（`"pat"`）、encryptedToken（secret-box）、tokenLast4、createdAt/updatedAt。复用 `createSecretBox` + `CREDENTIALS_SECRET` 范式（对照 composio-account-store）。
- GitHub client：fetch-based（不引 octokit），`https://api.github.com`，覆盖：list/search 用户可访问 repos、按 URL 定位 repo、repo issue 搜索（title 关键字）、单 issue 读取（title/body/url，不取 comments）、repo 元数据（defaultBranch、cloneUrl）。测试全部走 fake client/fixtures，不打真实 API。
- Integrations 页新增 GitHub tab：粘贴 PAT、显示 last4、断开。

### D8. 全重构迁移（用户定案）
- `/local`「本地 Agent = bridge token」产品面移除：创建 token 的 UI、`/local` 列表入口下线；导航换成 Computers + Tasks。
- 既有 `local-agent-workspace`（Chat/Files/Git/Shell/VNC/审批）组件整体收编为 Task Conversation 页的 Run 视图底座。
- `bridge_tokens` 表保留但仅作内部 session 凭据签发（D4）；`bridge_sessions`/`bridge_messages` 保留为 Run 的会话与消息存储。旧路由 `/local*` redirect 到 `/tasks`。

## 任务分解

### Slice 1 — Computer-first Client

**S1-T1 Computer 领域契约 + schema + store**
`packages/agent/src/computer-ports.ts`（D1/D2 契约与常量）；`packages/db/src/schema/computers.ts`：`computers`（id uuid pk、user_id FK、public_key_pem text notnull、name、platform、arch、client_version、runtime_inventory jsonb、tool_inventory jsonb、created/updated/last_seen、user_id 索引）+ `computer_pairing_codes`（id、user_id、code_hash unique、expires_at、used_at）；`packages/db/src/repositories/computer-store.ts`（createPairingCode/consumePairingCode/insert/updateInventory/touch/listByUser/getById/deleteById）；迁移 0043。底稿：既有 Slice 1 计划 Task 1，身份列按 D1 改。

**S1-T2 pairing + 签名认证 + computers router**
`packages/agent/src/crypto/computer-signature.ts`（Ed25519 sign/verify + 时间窗校验，纯函数可测）；`packages/api` 新增 `computerProcedure` 中间件与 `computers` router：`pair`（公开+code 校验）、`register`、`heartbeat`（含 `pendingCommands` 返回位，本切片恒空数组）、`list`/`get`/`delete`/`createPairingCode`（用户侧）。list 计算 connected、剥离敏感字段。接入 services 组装。底稿：既有计划 Task 2 + D1。

**S1-T3 CLI client mode + inventory 探测 + 心跳循环**
`args.ts` 判别式联合（`mode: "session" | "client"`；`--client`、`--pair`、`--name`（默认 hostname）；`--client` 与 `--agent` 互斥）；`computer-identity.ts`（identity 文件读写 0600）；`detect-inventory.ts`（D2，含 claude skills 扫描）；`computer-client.ts`（pair-or-load → register → heartbeat 循环，瞬时错误不退出，SIGINT/SIGTERM abort）；`cli-dispatch.ts` 分流并保持旧 session 模式完全不变。底稿：既有计划 Task 3/4/5/6 合并，认证按 D1。

**S1-T4 Web Computers 页**
`/computers` 路由 + `ComputerList`（10s refetch、Connected/Offline、runtime+skill capability 展示、git/gh installed/missing 只读事实、删除）；"Pair new computer" 对话框（生成 code + 展示一次性命令行）。导航加 Computers。底稿：既有计划 Task 7。

**S1-验收**（并入 S1-T4 commit 前）：CLI `--client` 不启动任何 Agent 即注册；重复启动同一 identity 不产生重复 Computer；停止 30s 后 Offline；`--agent` 旧路径行为不变；§19.1 全部测试点。

### Slice 2 — Task/Run 模型与 control channel

**S2-T1 tasks/runs schema + store + Opening Message 组装**
D3 两表 + 迁移；`bridge_sessions` 加 `run_id` 列（可空 FK）；`task-store`/`run-store`；`packages/agent/src/task/opening-message.ts`（§10.1 模板纯函数，空区块省略，Description 永不省略）+ 单测。

**S2-T2 Launch 下发与 control channel**
server：`launch-commands` 内存+DB 混合队列（run 创建即入队，ack 落库）；`/computer-ws`（D4 签名握手，推 launch、收 ack；复用现有 ws 基建模式）；heartbeat `pendingCommands` 降级路径；`sessionCredential` 预签发（内部化 bridge token 机制）。幂等测试：重复投递同一 runId 只产生一次待启动。

**S2-T3 tasks router：原子 Start（§8.5）+ Run 生命周期**
`tasks.create`（校验 name/description 必填、computer 所有权+在线、agentKind ∈ 该 computer inventory；无 GitHub 也可 Start；创建 task+run+opening message+launch 入队，一次事务）；`tasks.list/get`；`runs.updateStatus`（computerProcedure，client 回报状态与真实错误、workspacePath、sessionId 绑定）；`tasks.retry`（新顺序 Run，重抓快照位留空到 S4）。§19.2 中不依赖 GitHub 的断言在此先落一部分（他人 Computer 拒绝、离线拒绝、无生命周期聊天消息）。

### Slice 2.5 — Headless 启动链路

**S25-T1 CLI：LaunchCommand → Stand-alone Workspace → Runtime → relay 绑定**
client mode 收到 launch（WS 或 heartbeat）：ack → `runs.updateStatus(preparing_workspace)` → 建 `~/.better-agent/tasks/<taskId>/` → `starting_runtime` → 组装 Task Start Context（D3 切分：description + skill 解析（D6）+ workspace 路径 + 环境事实 §10.2）→ 用选定 adapter 在 workspace 启动 runtime → 用 `sessionCredential` 接现有 session relay → 回报 sessionId + `running`。失败回报 `failed` + 真实错误。幂等：seen runId 去重。
**验收（headless 闭环）**：`curl`/脚本调 `tasks.create` → 真机 client 收到 launch → runtime 在托管目录跑起来 → relay 有消息流。

**S25-T2 §19.2 集成测试补全**
in-memory router/store + fake control channel：Task/Run 已存、Opening Message 已存、恰一条幂等 Launch、stand-alone 覆盖、未验证 gh 仍可启动、Task Name 不进指令。

### Slice 3 — Wizard、Task List、Task Conversation

**S3-T1 Task List 页 + 三步 Wizard**
`/tasks` 列表（状态、computer、runtime、进入 conversation）；`/tasks/new` 三步 Wizard：Step1 Computer（Connected/Offline）→ Runtime（来自 inventory，换 Computer 清空不兼容选择）→ 只读 git/gh → Skill Palette（capability none 整块隐藏，换 Runtime 重置）；Step2 Name+Description 必填，`/` autocomplete 只出 Palette 勾选项、插入 `/name` 纯文本（复用 chat composer skill-picker 范式）；Step3 GitHub 占位（本切片禁用态，S4 点亮），直接 Start 无 Review。§19.3 Testing Library 全套。

**S3-T2 Task Conversation 页 + Run 视图收编**
`/tasks/$taskId`：首条渲染 openingMessage（保留 `/skill` 原文），后续消息 = 当前 Run 绑定 session 的现有消息流组件；Run 状态/启动错误显示在消息历史之外（§11）；复用 `local-agent-workspace` 的 Chat/Files/Git/Shell 作为 Run inspection tabs。retry 按钮（失败 Run 后建新 Run）。

**S3-T3 导航重构 + 旧 /local 下线**
导航：Tasks、Computers 替代 Local Agents；`/local*` redirect `/tasks`；移除 bridge token 创建 UI；`add-local-agent-dialog` 等孤儿组件清理。CONTEXT.md 术语不变。

### Slice 4 — GitHub Context 与 Repository Workspace

**S4-T1 GitHub Connection + client + Integrations tab**
D7 全部：表+迁移、`github-connection-store`（secret-box）、fetch-based client + fake、`github` router（connect/disconnect/status、searchRepositories、lookupRepositoryByUrl、searchIssues、getIssue）、Integrations GitHub tab。§19.6 fake 测试。

**S4-T2 Start 时 Issue 快照 + Wizard Step3 点亮**
`tasks.create` 接受 `repository + issueNumbers[]`：校验 issue ∈ repository、无 repository 时拒绝 issue；启动时（含 retry 的每个新 Run）经 GitHub client 抓 title/body/url 快照存 Run；Opening Message GitHub 块（§10.1 多 issue 顺序）；Launch payload 带快照与 repository。Wizard Step3：repo 搜索+URL 粘贴、动态多 Issue、无 repo 时 Issue 禁用、全空仍可 Start。§19.2 的 GitHub 侧拒绝用例 + §19.3 Step3 用例。

**S4-T3 CLI Repository Cache + repo-backed Workspace**
D5 全部：bare clone、fetch、文件锁、worktree、branch；launch 的 `workspace.kind === "repository"` 路径接通；同 repo 第二个 Task 复用 cache 且独立 worktree；sync 失败 → Run failed 真实错误。§19.5 fake fs/process 测试 + 真机冒烟。

**S4-T4 Runtime Adapter conformance（§19.4）**
共享 Task Start Context 测试跑 4 个 adapter：正确 workspace、同一核心 Description、多 Skill Reference 生效（claude-code）/capability none 不伪装（其余）、原生能力差异不被掩盖。

### 收尾

**F-T1 全量验证 + 发版 + 汇报**
全仓 `pnpm check-types` + `pnpm check` + 全量 test + build；bump bridge-cli 版本触发发版（先发版跑绿再叫用户测）；`docs/superpowers/plans/` 留 progress 记录；汇总报告（含 §22 十四条闭环逐条对照）通知用户。

## 执行方式

- 逐任务 SDD：为每个任务写 brief 到 `.superpowers/sdd/refactor-<taskId>-brief.md`，派实现子代理，报告写 `refactor-<taskId>-report.md`；主会话从 git diff 验证（子代理可能中途截断且不提交——从 git 状态核实并亲自补完），review 后 commit。
- 顺序：S1-T1 → … → F-T1 严格串行（每个任务都依赖前序 schema/契约）；同任务内部子代理可并行拆 server/CLI 时才拆。
- 每个 Slice 结束跑该 Slice 验收清单再进入下一个。

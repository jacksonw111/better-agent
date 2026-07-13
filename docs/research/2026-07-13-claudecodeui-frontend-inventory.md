# claudecodeui (CloudCLI) 前端交互与组件明细清单

- 日期：2026-07-13
- 来源：`siteboon/claudecodeui`（现名 CloudCLI，v1.36.1，AGPL-3.0），HEAD `5884573`，逐目录源码阅读（`src/` 378 个文件、24 个组件目录）
- 配套报告：[`2026-07-13-claudecodeui-comparison.md`](2026-07-13-claudecodeui-comparison.md)（功能对比与技术栈）
- 用途：作为我们 local agent 前端重构的参照实现清单。**我们保持 cli ⇄ relay server ⇄ web 架构不变**，文末附每个功能块在我们架构下的落地前提标注。
- 文中相对路径均指 claudecodeui 仓库的 `src/`

---

## 一、应用骨架与布局

### 1.1 根组件与 Provider 层级

- **`App.tsx`**：`I18next → Theme → Auth → WebSocket → Plugins → TasksSettings → TaskMaster → ProtectedRoute → Router`。路由只有 `/` 与 `/session/:sessionId`（会话经 URL 选中）。
  - 值得抄：`detectRouterBasename()` 从 manifest/script 标签的 href 反推反向代理路径前缀作 Router basename → 支持子路径部署。
- **`components/app/AppContent.tsx`**：三栏根布局 `fixed inset-0 flex`——左 Sidebar + 中 MainContent + 全局 CommandPalette。桌面侧栏常驻；移动端抽屉（translate-x 滑入 + backdrop-blur 遮罩）。
  - 每 5s 轮询 `api.runningSessions()` 同步运行中会话（sessionId/startedAt/statusText/canInterrupt）。
  - 值得抄：① 监听 ServiceWorker `notification:navigate` 消息实现推送点击跳会话；② 用 `visualViewport` 算 `--keyboard-height` CSS 变量，iOS 软键盘弹出时容器上移。

### 1.2 MainContent 多 tab 布局

- **`main-content/view/MainContent.tsx`**：`Header + 内容区 + EditorSidebar`（侧边代码编辑器，可拖宽/展开占满）。
  - **tab 切换机制**：chat 面板用 `block/hidden` 保活，其余（files/shell/git/tasks/browser/`plugin:*`）按需挂载。
  - `PaletteOps` 注册表：向命令面板注册 `openFile`（切 files tab）/`openFileInEditor`（原地开侧栏编辑器）等跨组件操作。
  - `useFileOpenResolver`：把 chat 里的相对文件引用解析成真实文件再打开。
- **`MainContentHeader` / `TabSwitcher`**：可横向滚动的药丸组（两侧渐变遮罩 + ResizeObserver 判断可滚动）；内置 chat/shell/files/git，条件加 browser/tasks，再拼接已启用插件 tab。lg 以上显示文字，否则仅图标。
- **`Title`**：chat+会话时显示会话摘要 + 项目名 + Provider Logo。

### 1.3 QuickSettingsPanel（快捷设置）

- **`quick-settings-panel/view/QuickSettingsPanelView.tsx`**：右侧滑出面板 + **可上下拖拽的把手**（位置存 localStorage，5px 拖动阈值防误触）。
- 开关全集：暗色模式、语言选择、`showRawParameters`（工具原始参数）、`showThinking`（思考流显隐）、`sendByCtrlEnter`、`voiceEnabled`。全部经 `useUiPreferences` 持久化（localStorage + 跨标签同步）。

### 1.4 CommandPalette（⌘K 命令面板）

- **`command-palette/CommandPalette.tsx`**：`cmdk` 驱动，**多级页面栈**（actions/files/sessions/commits/branches），Backspace 返回；顶层每组前 5 条 + "Browse all" 进子页。
- 命令分组：Actions（新会话/设置/切主题）、Navigate（跳 tab）、Git（fetch/pull/push）、Settings 子页直达、Sessions（列表 + **消息全文命中**，带 snippet）、Files/Commits/Branches（文件→打开，分支→checkout）。
- 值得抄：`useSessionMessageSearch` 复用后端 ripgrep 会话搜索（SSE + EventSource，250ms 防抖，`seqRef` 序号防竞态）。

---

## 二、Sidebar：项目/会话两级信息架构

### 2.1 结构

- **`sidebar/view/Sidebar.tsx`**：折叠态 `SidebarCollapsed`（12px 竖条：展开/设置/报 Issue/Discord + 更新角标）/ 展开态 `SidebarContent` + `SidebarModals`。逻辑收敛在 `useSidebarController`。
- **`SidebarHeader`**：Logo、刷新（旋转动画）、新建项目、折叠按钮；搜索区 = 模式分段控件（Projects / Conversations / Running(绿色计数徽标) / Archive）+ 搜索框；空态显示 `⌘K` 提示。
- **`SidebarContent`**：按 `searchMode` 四分支：
  - `conversations`：全文搜索结果按 项目→会话→逐条消息片段 分组，`<mark>` 高亮命中，U/A 标注角色，`scannedProjects/totalProjects` 进度条。
  - `running`："Running now" 计数条 + 复用项目列表（forceExpanded）。
  - `archived`：归档项目卡 + 按项目分组的归档会话，每条带恢复(RotateCcw)/永久删除(Trash2)。
  - 默认：`SidebarProjectList`。

### 2.2 项目/会话行

- **`SidebarProjectItem`**：星标置顶（后端 `isStarred` 字段）、项目名+会话数+路径缩略、展开箭头；**手风琴展开**（同一时刻只展开一个项目）；hover 露出重命名/删除；内联重命名输入（Enter 确认/Esc 取消）。
- **`SidebarProjectSessions`**：项目展开后左边框缩进的会话区；顶部"新建会话"；骨架屏；**分页 = "Load more sessions" 按钮**（游标 `sessionMeta`，非滚动触底）。
- **`SidebarSessionItem`**：Provider Logo + 摘要名 + 消息数 Badge + 紧凑时间/处理中转圈；左侧脉冲圆点（琥珀=需关注、绿=最近活跃）。
  - 值得抄：桌面用 `<a href=/session/id>`——左键拦截走 SPA 导航，Cmd/Ctrl/中键/右键走原生新开标签。
- **`SidebarModals`**（Portal）：
  - 删除项目三选项：**归档**(EyeOff) / **删除全部数据**(destructive，显示会话数警告) / 取消。
  - 删除会话：**归档（保留历史）** / **永久删除** / 取消；已归档隐藏"归档"项。
- 排序：星标置顶 → 最近活动日期或名称 `localeCompare`；过滤：displayName+path 子串。

### 2.3 会话操作 REST 全集

`toggleProjectStar` / `renameProject` / `deleteProject(id, deleteData)` / `deleteSession(id, hardDelete)` / `renameSession` / `restoreProject` / `restoreSession` / `getArchivedSessions`。

---

## 三、聊天消息区（chat/）

### 3.1 容器与消息树

- **`ChatInterface.tsx`**：装配 `useChatProviderState` / `useChatSessionState` / `useChatComposerState` / `useChatRealtimeHandlers` 四个 hook；`PermissionContext.Provider` 下发待批权限；渲染 `ChatMessagesPane` + `ChatComposer` + `CommandResultModal` + 悬浮"回到底部"；全局 Esc = abort。
- **`ChatMessagesPane.tsx`**：滚动容器；空态 `ProviderSelectionEmptyState`；顶部"加载更早/全部"分页；`groupConsecutiveTools` 分组。
  - 值得抄：`messageKeys.ts` 稳定 key（意向 key + 出现序号），prepend 历史消息时不整列重挂载、不跳动。
- **`MessageComponent.tsx`**（memo，单条消息）按 `type` 分支：
  - **user**：右侧蓝色 `rounded-2xl` 气泡，上挂 `ChatMessageImages` 附件卡；时间戳 + 复制按钮。
  - **assistant/tool/error**：左侧头像行（provider logo / 🔧 / !）。`isToolUse` → Markdown(displayText) + `ToolRenderer(input)` + 按需 `ToolRenderer(result)`；`interactive_prompt` → 琥珀色只读选项卡（解析 `❯ 1. Yes` 文本菜单）；thinking → `Reasoning` 折叠块；纯 JSON → 代码块；底部复制 + 朗读(`MessageSpeakControl`) + 时间戳。
  - `task_notification`：一行小圆点+灰字（绿=完成/琥珀=进行）。
- **`ToolGroupContainer.tsx`**：≥2 条连续同名工具折叠成一行"图标 / 标签 / x{N} / 前 2 条预览, +N more"，点击展开；隐藏中的 reasoning 不打断连续段。

一条 assistant 工具消息的组件树：
```
MessageComponent
└─ ToolRenderer(mode=input)
   └─ 注册表路由 → OneLineDisplay | BashCommandDisplay | CollapsibleDisplay(+ContentRenderer) | PlanDisplay | SubagentContainer
└─ ToolRenderer(mode=result)   （可选；Bash 结果内联进命令行、成功噪声被抑制、错误红框）
```

### 3.2 工具渲染注册表（重点，`tools/configs/toolConfigs.ts`，530+ 行）

声明式 `TOOL_CONFIGS: Record<toolName, {input, result}>`：
- `input.type ∈ one-line | collapsible | plan | hidden`；`result ∈ hidden | hideOnSuccess | special`
- `getValue / getSecondary / title / getContentProps` 函数式取值；未注册回退 `Default`
- `shouldHideToolResult`：成功隐藏但**错误始终显示**
- `ToolRenderer.tsx` 按 `contentType` 路由到 8 种内容渲染器：`diff / markdown / file-list / todo-list / task / question-answer / text / success-message`

| 工具 | input 形态 | result 形态 |
|---|---|---|
| Bash | one-line（terminal 绿 `$`） | special → 输出内联在命令行卡内 |
| Read | one-line（open-file，可点击打开） | hidden |
| Edit / Write / ApplyPatch | collapsible + diff（badge Edit/New/Patch） | hideOnSuccess |
| Grep / Glob | one-line（jump-to-results 锚点跳转） | collapsible file-list（"Found N files"） |
| TodoWrite | collapsible todo-list | success-message |
| TodoRead | one-line | todo-list（解析 JSON） |
| TaskCreate/Update/List/Get | one-line（violet 边） | List/Get → collapsible task（进度条） |
| Task（子代理） | collapsible markdown（`Subagent / {type}: {desc}`，紫色） | markdown |
| AskUserQuestion | collapsible question-answer，defaultOpen | — |
| exit_plan_mode / ExitPlanMode | plan → `PlanDisplay` | — |
| Default | collapsible text（JSON.stringify） | — |

状态徽章 `ToolStatusBadge`：`running / completed / error / denied`（denied 靠 `CLAUDE_DENIAL_MESSAGES` 文本匹配）。

### 3.3 工具展示子组件

- **`OneLineDisplay`**：4 形态（terminal 深色药丸 / open-file / jump-to-results / 默认），左色条 + copy + 状态徽章。
- **`BashCommandDisplay`**（值得抄）：Codex 风命令行，`$` 前缀，有输出才可展开；输出晚到用 `autoAppliedRef` 只自动展开一次；行数、copy、运行中 spinner，`max-h-80` 滚动。
- **`CollapsibleDisplay` / `CollapsibleSection`**：统一折叠块，按 `toolCategory` 左边框配色；展开时标题 sticky；可选 raw params 折叠。
- **`ToolDiffViewer`**：VSCode 风 diff（+/- 行），文件名可点。
- **`PlanDisplay`**（值得抄）：Card+Collapsible，流式时 Shimmer；从 `usePermission()` 找到 ExitPlanMode 待批请求，底部 **Revise / Build(⌘↩)** 直接作出权限决定——**计划审批内联在计划卡里**，不进 banner。
- **`SubagentContainer`**（值得抄）：紫色左条折叠块；显示 prompt、"Currently: {tool}" 实时指示、完成 ✓ 计数、可展开工具历史（含 error 标记）、最终结果 `line-clamp-6`。
- ContentRenderers：`TodoList`（复用 Queue UI）、`TaskListContent`（正则解析 `#id [status] subject` + 进度条）、`FileListContent`（可点文件名）、`QuestionAnswerContent`（只读已答问题）。

### 3.4 Permission / Approval 流程

- WS `permission_request` → 去重 → `pendingPermissionRequests` + 提示音；`permission_cancelled` 移除；`complete`/切会话清空；**重连时 `chat_subscribed` ack 携带 `pendingPermissions` 重放**。
- **`PermissionRequestsBanner.tsx`**（composer 上方）：
  - 过滤 ExitPlanMode（走 PlanDisplay 内联）。
  - 自定义面板注册表 `permissionPanelRegistry`（现注册 AskUserQuestion → `AskUserQuestionPanel`）。
  - 通用 `Confirmation` 卡：盾牌图标 + 工具名 + Allow rule（`buildClaudeToolPermissionEntry`，如 `Bash(git log:*)`）+ 可折叠 View tool input。
  - **三档按钮**：Deny（allow:false + message）/ **Allow & remember**（写 `allowedTools` 并批量放行同 entry 的所有 pending）/ Allow once。
- 上行：`chat.permission-response {requestId, allow, updatedInput, message, rememberEntry}`。无前端超时（超时由后端产生 denial）。
- **`AskUserQuestionPanel`**（值得抄）：多问题分步向导，进度点、单/多选、数字键 1-9 选项 / 0=Other / Enter 前进 / Esc 跳过；Other 内联输入；答案经 `updatedInput.answers` 随 allow:true 回传。

### 3.5 Composer 输入框全能力（`useChatComposerState.ts` 1222 行）

- **文本**：覆盖层高亮 @文件引用；自动扩高；Enter 发送 / Shift+Enter 换行 / `sendByCtrlEnter` 可反转；**Tab 循环权限模式**。
- **图片**：react-dropzone 拖拽 + 粘贴 + 选择器（png/jpg/gif/webp/svg，≤5MB）；缩略图卡带上传进度/错误/移除；发送时先 POST `/api/assets/images` 再随 `chat.send` 带 `images`。
- **语音**：MediaRecorder → POST `/api/voice/transcribe`（OpenAI 兼容 STT）；Send 按钮可"停止录音并发送"。
- **Slash 命令**：`/word` 触发 `CommandMenu`（portal 分组：Frequent/Built-in/Skill/Project/User；键盘导航）；数据来自 `/api/commands/list` + provider skills；**按历史使用频次排序**（localStorage）；skill 命令插入输入框，其余直接执行。
- **@文件引用**：项目文件树扁平化 + `@` 触发下拉，选中插入路径并高亮。
- **模式切换**：`permissionMode ∈ default|acceptEdits|auto|bypassPermissions|plan` 彩色圆点按钮。
- **Effort 下拉**：按 provider 给档位（claude/codex/opencode 各 low…max）。
- **忙时队列**（值得抄）：run 中回车 → `queuedDraft`（content+images+**发送时快照的 options**，按 session 持久化 localStorage）；`QueuedMessageCard` 可编辑/删除；turn 结束（isLoading 落沿）自动重放完整 submit 路径（含 slash 解析/图片上传）；跨会话切换不误发。
- **其他**：`TokenUsageSummary`（点开 cost 视图 modal）、`ActivityIndicator`（Shimmer 动作词轮换 + 计时 + Stop/esc）、`CommandResultModal`（help/model/cost/status 四视图）。

---

## 四、配置面（Settings / MCP / Skills / 插件 / Provider 登录）

### 4.1 Settings 整体

- **`settings/view/Settings.tsx`**：全屏模态；左侧 10 个主 tab（桌面竖排 aside / 移动横向 Pill）：`agents / appearance / git / api / voice / tasks / browser / plugins / notifications / about`。
- **Agents tab 二级结构**：Agent 选择器（claude/cursor/codex/opencode）× 分类 tab（account/permissions/mcp/skills）→ `AgentCategoryContentSection` 按二维分发。
- **`useSettingsController`**：状态中枢，**500ms 防抖自动保存**，`isInitialLoadRef` 跳过首次写入。权限档位存 localStorage，通知偏好走后端 API。
- 各 tab：appearance（暗色/语言/项目排序/编辑器字号等，派发自定义事件跨实例同步）、git（user.name/email 表单）、api（API Keys + GitHub Token CRUD，含启停/复制/可见性切换）、voice（OpenAI 兼容 STT/TTS 配置）、notifications（桌面通知与 Web Push 按环境二选一 + 声音测试 + 三事件订阅 actionRequired/stop/error）。

### 4.2 MCP 管理

- **`McpServers.tsx`**：server 卡片列表——transport 图标（stdio/sse/http）、scope badge（user/project/local）、command/url/args/env（`maskSecret` 脱敏）；编辑/删除。
  - 两个新增入口：**"Add Global MCP Server"（一次写入全部四个 provider）** / "Add {Provider} MCP Server"。
  - `cloudcli-` 前缀的 server 标记 **Managed 只读**（由功能开关自动写入，防用户改坏）。
- **`McpServerFormModal`**：**表单/JSON 双导入模式**；scope 按钮组（编辑时锁定）；transport 相关字段动态切换；codex 专属字段（working dir、Bearer Token Env Var）。
- REST：`GET/POST/DELETE /api/providers/{provider}/mcp/servers`（user→project→local 分批加载，user 先渲染）+ `POST /api/providers/mcp/servers/global`；**30s 模块级缓存**；改名=先 POST 新再 DELETE 旧。
- **注意：无测试连接、无启停开关、无 OAuth**——纯配置 CRUD。

### 4.3 Skills

- **`ProviderSkills.tsx`**：**"发现 + 安装"面板，没有启用/禁用开关，不能在线编辑 SKILL.md**。
  - 搜索 + 按 scope 分组展示（user/plugin/repo/project/admin/system 各有配色 badge），卡片显示 command(mono)/name/description/只读 Source 路径。
  - 新增：Dialog 拖拽区，**支持上传单个 SKILL.md 或整个技能文件夹**（递归找 SKILL.md 作根，其余文件转 base64，≤500 文件/30MB）；可展开预览安装目标路径。
  - project/repo 级技能只读展示（靠扫描工作区发现）；opencode 不显示 skills 分类。
- REST：`GET/POST /api/providers/{provider}/skills`；**5 分钟缓存**。

### 4.4 插件系统

- **`PluginSettingsTab.tsx`**：市场 + 已装管理二合一。
  - 从 Git URL 安装（带安全警告）；官方/非官方推荐卡各一键 Install（已装自动从推荐过滤）。
  - `PluginCard`：图标/版本/slot/运行中脉冲点/作者/repo；操作 = 更新（git pull）/ 卸载（两步确认）/ **启用禁用 ToggleSwitch**。
- **`PluginTabContent.tsx`**（插件注入 UI 的机制）：插件以 `slot:'tab'` 注入独立 tab；前端带 auth 头 fetch 插件 JS → Blob URL 动态 `import()` → `mod.mount(container, api)`；`api` 暴露 `context`(theme/project/session)、`onContextChange`、`rpc(method,path,body)`（→ `/api/plugins/{name}/rpc/*`）。
- REST：`GET /api/plugins`、`POST /install`、`DELETE /{name}`、`POST /{name}/update|enable`。

### 4.5 Provider 登录 / 凭证

- **`ProviderLoginModal.tsx`**：不做 OAuth 弹窗，**内嵌 StandaloneShell 直接跑 CLI 登录命令**（claude `/login`、`cursor-agent login`、`codex login`、`opencode auth login`），跑完回调 exitCode，模态保持打开供看输出。
- **`useProviderAuthStatus`**：`GET /api/providers/{provider}/auth/status` → `{authenticated, email, method}`；四 provider 并发刷新。
- **`AccountContent`**：连接状态 badge、登录邮箱、登录/重新认证按钮；`method==='api_key'` 时隐藏登录按钮。

### 4.6 权限设置（Settings 内，区别于运行时审批）

- **`PermissionsContent.tsx`** 按 agent 三种形态：
  - **Claude**：`skipPermissions` 复选框（橙色警告）+ **Allowed / Blocked Tools 白黑名单**可编辑列表（输入回车添加、快捷添加 `Bash(git log:*)` 等常用项、逐项删除）。
  - **Cursor**：同结构，对象是 Shell 命令白/黑名单。
  - **Codex**：三档单选 default / acceptEdits / bypassPermissions + 可展开技术细节。

---

## 五、IDE 面板

### 5.1 文件树（file-tree/）

- **能力**：全量加载（非懒加载）、右键菜单、新建/重命名/删除/上传/下载、图片预览、拖拽上传（含整文件夹）、simple/compact/detailed 三种视图（detailed 含大小/时间/rwx 权限网格）。
- 组件：`FileTree`（六 hook 整合 + 拖拽遮罩 + 内联新建 + 删除确认 + 3s toast）、`FileTreeNode`（递归、缩进导引线、内联重命名）、`FileContextMenu`（file/directory/空白三种上下文；值得抄 `calculateViewportSafePosition` 视口防溢出）、`ImageViewer`（authenticatedFetch 拉 blob 显示，卸载 revoke）。
- 值得抄：文件夹下载 = JSZip 前端递归拉取打包；上传用原生 XHR 拿进度（封顶 99% 留给服务端写盘）；`webkitGetAsEntry` 递归读文件夹并过滤 .DS_Store；文件名校验（非法字符/Windows 保留名）。
- REST：`GET/POST/PUT/DELETE /api/projects/:projectId/files*`。

### 5.2 代码编辑器（code-editor/）

- CodeMirror 6（`@uiw/react-codemirror`）：JS/TS/JSX/TSX/PY/HTML/CSS/JSON/MD + 自定义 `.env` lexer；oneDark 暗色跟随全局；**diff = `unifiedMergeView` 统一合并视图** + minimap 变更条 + 自动滚到首个变更块 + 上/下变更块导航面板。
- 四态分支：加载中→媒体预览（图/PDF/音频/视频）→二进制占位→编辑器；侧栏/全屏/弹出三种容器模式；Markdown 预览切换；HTML 新窗口 iframe(sandbox) 预览。
- 保存：Cmd+S；媒体/二进制拦截不写盘；saveSuccess 2s 提示。编辑器设置（换行/minimap/行号/字号）localStorage + 自定义事件跨实例同步。

### 5.3 Git 面板（git-panel/，22 端点）

- **`useGitPanelController.ts`**（820 行）汇聚全部逻辑；`GitPanel` 三视图：**changes / history / branches**。
- Changes：Staged/Changes 两段 + Stage All/Unstage All + 状态码图例；勾选文件 stage/unstage（**操作队列串行化 + 乐观更新**，`pendingStageOps` 计数防 status 刷新覆盖）；丢弃改动/删除未跟踪（确认弹窗）。
- CommitComposer：textarea + Ctrl+Enter 提交 + **✨AI 生成 commit message**（`POST /api/git/generate-commit-message`，带 provider）+ 按项目缓存草稿。
- Header：分支下拉（切换/新建/删除）、ahead/behind 计数、fetch/pull/push/publish。
- History：提交列表 + `CommitGraphStrip` 提交图 + 展开看 commit diff + 撤销最近本地提交。
- 与编辑器联动：`/api/git/file-with-diff` 打开文件带 old/new 直接进 diff 视图。
- 值得抄：`selectedProjectIdRef` 比对丢弃切项目后的陈旧响应。

### 5.4 内置终端（shell/ + standalone-shell/）

- 架构：xterm.js ⇄ 单 WS `/shell` ⇄ node-pty。单实例单终端，多终端由上层每 session/tab 挂一个 `Shell`。
- `useShellTerminal`：scrollback 1 万、VSCode 配色、FitAddon/Clipboard(OSC52)/WebLinks/WebGL(失败降 Canvas)；ResizeObserver 防抖 fit 后发 `{type:'resize',cols,rows}`；Ctrl/Cmd+C 复制选区、Ctrl/Cmd+V 粘贴发 `{type:'input'}`。
- `useShellConnection`：onopen 发 `{type:'init', projectPath, sessionId, provider, cols, rows, initialCommand, isPlainShell, forceRestart}`；`{type:'output'}` 写终端；解析 "Process exited with code N" 回调完成。
- 移动端（值得抄）：`TerminalShortcutsPanel` 虚拟按键条（Esc/Tab/CTRL/ALT/方向/粘贴）；**扫描 xterm 缓冲区识别 CLI 编号菜单**（`❯ N. label` + "esc to cancel"）渲染成可点按钮注入数字/Esc。
- `StandaloneShell`：`Shell` 的独立封装（标题头/关闭/完成态），用于会话外跑一次性命令（provider 登录模态就用它）。

### 5.5 browser-use

- Agent 浏览器会话监控面板（非用户操控）：展示 Playwright/Chromium 运行时状态与安装、agent 打开的浏览器会话列表；主区渲染会话**截图** + 按 viewport 百分比叠加 agent 光标；停止/删除会话。纯轮询无 WS。

---

## 六、跨切面基础设施

### 6.1 WebSocket 协议

- **连接**：单一长连接（`contexts/WebSocketContext.tsx`）；`subscribe(listener)` 广播分发（同步遍历 ref，避免 React 批处理丢帧）。
- **上行**（`type`）：
  - `chat.subscribe {sessions:[{sessionId, lastSeq}]}` —— 订阅/重连复用
  - `chat.send {sessionId, content, options:{..., images}}`
  - `chat.abort {sessionId}`
  - `chat.permission-response {requestId, allow, updatedInput, message, rememberEntry}`
- **下行**（`kind`）：
  - provider 消息类：`text / tool_use / tool_result / thinking / stream_delta / stream_end / error / complete / status / permission_request / permission_cancelled / session_created / interactive_prompt / task_notification`
  - 网关类：`chat_subscribed`（ack，带 `isProcessing` + `pendingPermissions`）、`session_upserted`、`loading_progress`、`protocol_error`
  - 合成类：`websocket_reconnected`（客户端注入）
- **重连**：onclose 固定 3s 重连（非指数退避）；重连后先 REST `refreshFromServer` 再重发 `chat.subscribe`。
- **seq 重放**：每个 sequenced 帧更新 per-session `lastSeqRef`，subscribe 带 `lastSeq`，后端只重放遗漏事件。
- **审批重投**：不本地持久化，靠 `chat_subscribed` ack 的 `pendingPermissions` 重投；仅对当前查看 session 应用；从无到有时播提示音。

### 6.2 状态管理与流式合并

- **无 zustand/redux**：React Context + ref-based store。
- **`stores/useSessionStore.ts`**：per-session slot（Map），存 `serverMessages`(REST) / `realtimeMessages`(WS) / `merged` / 分页 / tokenUsage；只在 active session 变更时强制渲染；消息不进 localStorage，后端为真相源。
- **流式**：`stream_delta` 累加到 ref，**100ms 节流**批量 `updateStreaming`（固定 id `__streaming_<sid>` 原地替换）；`stream_end` finalize 成唯一 id 的 text 行。
- **合并 `computeMerged`**：server+realtime 按时间戳交织、按 id 去重；`dedupeAdjacentAssistantEchoes` 折叠流式→落盘同文回声；refresh 后只删服务端已落盘的 realtime 行（防闪空）；乐观用户消息按文本指纹+时间窗去重；realtime 上限 500 条。

### 6.3 移动端 / PWA / 推送

- 断点 768px（`useDeviceSettings`）。
- Service Worker：`/api/`、`/ws` 不拦截；导航 network-first（离线兜底）；哈希资源 cache-first。
- Web Push：`useWebPush` —— 请求通知权限 → 拉 VAPID 公钥 → `pushManager.subscribe` → POST subscription；SW `push` 事件 showNotification，点击 focus 窗口并导航到 `/session/<id>`。
- iOS：theme-color meta 随暗色切换；`visualViewport` 软键盘适配。

### 6.4 主题 / i18n / Auth

- 主题：localStorage 优先，否则 `prefers-color-scheme`；Tailwind class 策略；用户未手动设定时跟随系统变化。
- i18n：i18next，**10 种语言**（en/fr/ko/zh-CN/zh-TW/ja/ru/de/tr/it），7 个命名空间。
- Auth：JWT 存 localStorage `auth-token`；`authenticatedFetch` 注入 Bearer + 支持响应头 `X-Refreshed-Token` 滚动刷新；WS/EventSource 把 token 塞 query。

### 6.5 其他模块（简要）

- **task-master/**：TaskMaster AI 任务看板（status/priority/依赖/子任务树），WS `task_notification` 联动。
- **prd-editor/**：`.prd` 文件的 Markdown 编辑器（文档注册表/覆盖确认/快捷键）。
- **project-creation-wizard/**：分步新建项目向导，支持 GitHub clone（带进度）。
- **onboarding/ / version-upgrade/**：首次引导；GitHub release 版本比对升级弹窗（git/npm 两种安装模式）。

---

## 七、在我们架构（cli ⇄ relay server ⇄ web）下的落地前提标注

| 类别 | 功能块 | 前提 |
|---|---|---|
| **纯前端，现有事件流即可做** | 工具渲染注册表化（3.2/3.3）、工具连续分组折叠、消息稳定 key、BashCommandDisplay/SubagentContainer/PlanDisplay 内联计划审批、AskUserQuestionPanel 分步向导、interactive_prompt 选项卡、ActivityIndicator、⌘K 命令面板（先只含导航/设置/会话）、QuickSettings 面板、Tab 循环权限模式、Effort 下拉、i18n/主题、消息朗读 | 无新依赖，重构 web 组件即可；我们已有归一化事件与能力握手 |
| **需 server（云端）新 API** | 会话重命名/归档/星标/删除三选项（2.2/2.3）、忙时队列草稿服务器化（我们已有 send{when}，可补 UI 快照语义）、图片上传（`/api/assets/images` 对应我们的对象存储）、Web Push（VAPID + 订阅表）、Token 用量 modal、插件/推荐位（远期） | relay 已有 bridge_sessions 表，加字段与路由即可；推送需云端存订阅 |
| **需 bridge CLI 新通道（数据在用户机器）** | 文件树/编辑器（读写用户文件）、git 面板、内置终端（等价我们未实现的 runShell/带外通道，pty 流经 relay 转发）、跨会话 ripgrep 全文搜索、@文件引用（需 CLI 供文件列表）、Read/Edit 点击打开文件、provider 登录内嵌终端、多 provider 历史会话索引（各家落盘解析器在 CLI 侧跑） | 这是成本大头：CLI 需要新增 fs/git/pty/search 命令族 + 事件流；安全边界要设计（限制在工作区内） |
| **可走云端反而更容易** | 语音转写（STT 用我们云端 key，不必像它走本机代理）、AI 生成 commit message（云端模型直接生成） | — |
| **不建议跟进** | TaskMaster 看板、PRD 编辑器、Electron 壳、browser-use 面板（我们已有 CUA/VNC 更强） | 与我们方向不合或已被覆盖 |

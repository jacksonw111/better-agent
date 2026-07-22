# Claude Code 工具 / 事件渲染覆盖审计

> 只读审计。数据来源：
> - SDK 工具全集：`node_modules/.pnpm/@anthropic-ai+claude-agent-sdk@0.3.201_.../@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts`（`ToolInputSchemas` / `ToolOutputSchemas`）
> - 事件归一化：`apps/bridge-cli/src/normalize/claude-code.ts`
> - 前端渲染：`apps/web/src/components/bridge/bridge-tool-card.tsx`（`categoryOf`）、`bridge-turns.ts`、`bridge-turn-types.ts`、`activity-item-header.tsx`、`status-line.tsx`、`todo-list.tsx`、`task-card.tsx`、`task-tool-card.tsx`、`plan-approval-card.tsx`、`question-card.tsx`、`assistant-turn-block.tsx`、`packages/ui/src/components/chat/tool.tsx`（`PlainToolView` 兜底）、`apps/web/src/genui/tool-renderers.tsx`

## 0. 渲染管线（关键前提）

本地 agent（Claude Code）的 feed 走的是 **`renderActivityTool`**（`bridge-tool-card.tsx:182`），它只挂了 **`bridgeToolRegistry`**：

```
renderActivityTool(tool)
  → bridgeToolRegistry.match = categoryOf(toolName) !== null
      command  → <BashCommandCard>
      fileEdit / fileRead / search → <ActivityItem>
  → 未命中(null) → <ToolGroup> → <PlainToolView>  (WrenchIcon + 工具名 + 折叠的原始 JSON Arguments/Result)
```

**重要**：genui 的富渲染注册表 `cloudToolRegistry`（finance 卡、X/tweet 卡等，`tool-renderers.tsx`）**只在 `chat/chat-view.tsx` 的云端 web-agent 聊天里用**，本地 agent feed **完全没有接入**。所以本地 agent 的 Claude Code 工具，凡是 `categoryOf` 没识别的，一律掉进 `PlainToolView` 原始 JSON 折叠块。

`categoryOf` 是纯粹的**工具名子串正则**匹配，不看 input/output 结构：

```
COMMAND_RE   = /bash|shell|\bsh\b|zsh|exec|command|\brun\b|terminal/
FILE_EDIT_RE = /edit|write|create|patch|replace/
FILE_READ_RE = /read|view|\bcat\b|open/
SEARCH_RE    = /grep|glob|search|find|ripgrep/
```

这套正则对 Claude Code 的**固定英文工具名**（Bash/Read/Edit/Write/Glob/Grep）刚好命中，但对新一代工具名和 **MCP 工具（`mcp__server__tool`）** 会大面积**误命中 / 漏命中**，见第 3 节。

---

## 1. 全量对照表

### 1a. 内置工具（`ToolInputSchemas` 全集）

| Claude Code 工具（wire 名） | `categoryOf` 结果 | 实际渲染 | 评级 |
|---|---|---|---|
| `Bash` | command | ✅ `BashCommandCard`（$ 前缀、内联输出） | 覆盖良好 |
| `Read`(FileRead) | fileRead | ✅ `ActivityItem` Read 卡 | 覆盖良好（**图片/PDF 读取例外**，见第 2 节） |
| `Edit`(FileEdit) | fileEdit | ✅ `ActivityItem` + inline diff | 覆盖良好 |
| `Write`(FileWrite) | fileEdit | 🟡 `ActivityItem` fileEdit 卡；无 old_string，`diffFor` 出不了 diff，只显示原始 output | 可接受 |
| `Glob` | search | ✅ Search 卡（显示 pattern） | 可接受（未渲染 filenames 列表） |
| `Grep` | search | ✅ Search 卡 | 可接受 |
| `Task`(Agent 子代理) | null → **被 `foldTaskTool` 拦截** | ✅ `TaskCard`（子 agent 富卡片、工具历史） | 覆盖良好 |
| `TaskCreate` / `TaskUpdate` / `TaskList` | null → **被 `foldTaskListTool` 拦截** | ✅ `TaskToolCard`（**已由并行任务修好并落地**，`bridge-turns-tasklist.ts` 已 wire 进 `foldTool:170`） | 覆盖良好（处理中→**已完成**） |
| `TodoWrite` | **fileEdit（"write" 误命中）** | ❌ 渲染成空路径的 "Edit" 卡 | **真缺口 · 高频** |
| `WebFetch` | null | ❌ `PlainToolView` 原始 JSON | **真缺口 · 中高频** |
| `WebSearch` | **search（"search" 误命中）** | 🟡 Search 卡只显示 query，`results` 的 title/url 源列表掉进原始 pre | **真缺口 · 中频** |
| `NotebookEdit` | fileEdit（"edit"） | 🟡 fileEdit 卡；filePath 命中 notebook_path，但 new_source/old_source 出不了 diff | 缺口 · 低频 |
| `ExitPlanMode` | null → 一般以 **approval/permission** 到达 | ✅ `PlanApprovalCard`（`isExitPlanModeApproval`）；若作为纯 tool_use 到达则掉 `PlainToolView` | 覆盖良好（有边角） |
| `EnterPlanMode` | null | ❌ `PlainToolView`（通常无 payload/内部） | 噪声 · 可不做 |
| `TaskOutput` | null | ❌ `PlainToolView`（后台任务轮询输出） | 缺口 · 低中频 |
| `TaskStop` | null | ❌ `PlainToolView`（杀后台任务/shell） | 缺口 · 低频 |
| `ListMcpResources` | null | ❌ `PlainToolView` | 缺口 · 低频 |
| `ReadMcpResource` | fileRead（"read"） | 🟡 Read 卡但 filePath 空（input 是 `uri`/`server` 非 path），显示工具名 | 缺口 · 低频 |
| `ReadMcpResourceDir` | fileRead（"read"） | 🟡 同上 | 缺口 · 低频 |
| `Mcp` / **`mcp__<server>__<tool>`（真实 MCP 调用）** | **子串随机命中**（见 §3） | ❌ 误分类成 command/edit/search 卡，或 `PlainToolView` | **真缺口 · 平台核心 · 高频** |
| `ReportFindings`（代码审查结果） | **search（"find" 命中 "findings"）** | ❌ Search 卡，searchQuery 为空 | **真缺口 · 中频** |
| `REPL` | null | ❌ `PlainToolView`（JS 执行 + 输出） | 缺口 · 低中频 |
| `Workflow` | null | ❌ `PlainToolView`（多 agent 编排） | 缺口 · 低频 |
| `CronCreate` | fileEdit（"create"） | ❌ 误分类成 Edit 卡 | 缺口 · 低频 |
| `CronDelete` / `CronList` | null | ❌ `PlainToolView` | 缺口 · 低频 |
| `ScheduleWakeup` | null | ❌ `PlainToolView` | 缺口 · 低频 |
| `RemoteTrigger` | null | ❌ `PlainToolView` | 缺口 · 低频 |
| `Monitor` | null | ❌ `PlainToolView`（长驻监视/日志尾随） | 缺口 · 低中频 |
| `Artifact` | null | ❌ `PlainToolView`（发布可视化页面，有 URL） | 缺口 · 中频（值得富渲染） |
| `PushNotification` | null | ❌ `PlainToolView` | 噪声/低频 |
| `EnterWorktree` / `ExitWorktree` | null | ❌ `PlainToolView`（git worktree 隔离） | 缺口 · 低频 |
| `ClaudeDesign` | null | ❌ `PlainToolView` | 缺口 · 低频 |
| `Projects` | null | ❌ `PlainToolView`（项目知识库读写） | 缺口 · 低频 |
| `AskUserQuestion` | null → 以 **question 事件**到达 | ✅ `QuestionCard`（多选/单选富卡） | 覆盖良好 |

### 1b. 非工具事件（`normalize/claude-code.ts` emit 的 `NormalizedEvent`）

| 源 wire 帧 | normalize 结果 | 前端处理 | 评级 |
|---|---|---|---|
| `system` subtype=`init` | status `session_ready`（model/tools/skills/mcp/slashCommands…） | ✅ 专用 header/能力 UI，chat feed 隐藏（`HIDDEN_STATUS_KINDS`） | 正确 |
| `system` subtype=`commands_changed` | status `command_catalog` | ✅ 专用 slash UI，feed 隐藏 | 正确 |
| `system` subtype=`status`（permissionMode） | status `permission_mode_changed` | ✅ 折进 sessionReady detail | 正确 |
| `system` 其它（hooks/thinking_tokens/api_retry） | `NO_EVENTS` | ➖ 丢弃 | 正确（内部噪声） |
| `assistant` message text | message role=assistant | ✅ `Response` markdown 气泡 | 正确 |
| `assistant` tool_use block | tool started | ✅（见 1a） | — |
| `user` tool_result block | tool completed/failed | ✅ 回填工具卡 | 正确 |
| `user` text/thinking block | `NO_EVENTS` | ➖ 丢弃（SDK 注入的子代理 echo，不是人类输入） | 正确 |
| `result` | status `turn_usage`（cost/tokens/duration） | ✅ usage footer，feed 隐藏 | 正确 |
| `stream_event` `text_delta` | output text | ✅ 流式 `Response` | 正确 |
| `stream_event` `thinking_delta` | output reasoning=true | 🟡 `Reasoning` 折叠块（受 `showThinking` pref 门控） | 可接受（见第 2 节 thinking 质量） |
| `stream_event` 其它 | `NO_EVENTS` | ➖ 丢弃 | 正确（bookkeeping） |

### 1c. status 通知（bridge-cli 自产，`STATUS_NOTICES`）

13 个 key（restarting/restarted/stopped_by_server/agent_exited/stalled/session_resumed/extension_ui_auto_cancelled/resume_failed/model_format_invalid/approval_unknown/approval_invalid_option/question_unknown/event_truncated）**全部有中文文案 + 图标 + tone 映射**。

- `foldStatus` 用**白名单**：只有 `STATUS_NOTICE_KINDS`（=上面 13 个）∪ `HIDDEN_STATUS_KINDS` ∪ `PLAN_STATUS` 才会渲染/成为边界，未知 status 静默吞掉。
- 因此 `StatusLine` 里的 `humanizeStatus`（把 `foo_bar` → `foo bar`）**实际上是死代码/防御性兜底**——任何能被渲染的 status 一定已在 `STATUS_NOTICES` 表里。**没有 status 子类型会漏成原始 token**。✅ 覆盖完整。

---

## 2. 缺口清单（重点）

> 已按"用户可见频率"排序。`TaskCreate/TaskUpdate/TaskList` 不再列入——审计期间并行任务已把它接进 `TaskToolCard` 并落地。

### G1 · `TodoWrite` —— 假阳性误分类（最该修，高频）
- **input**：`{ todos: {content, status:"pending"|"in_progress"|"completed", activeForm}[] }`
- **output**：`{ oldTodos, newTodos }`（同结构）
- **当前**：工具名含 "write" → `FILE_EDIT_RE` 命中 → 渲染成 fileEdit `ActivityItem`。`filePath()` 找不到路径 → 空；`diffFor` 拿不到 old/new_string → 无 diff。结果是一张 **label="Edit"、路径空、只能展开看原始 `{todos:[...]}` JSON** 的卡。
- **丑陋点**：Claude Code 最高频的规划工具之一，全程显示成"编辑了一个没有名字的文件"。
- **建议**：直接复用现成的 `todo-list.tsx` `<TodoList>`（`parseTodoItems` 已能吃 `todos` 字段）。在 `foldTool` 里像 `isTaskListTool` 一样拦截 `TodoWrite`，折成一个 `plan`/`todo` turn（或新 turn kind），渲染 checklist，随后续 `TodoWrite` 原地替换 items。
- **优先级**：**P0**

### G2 · MCP 工具调用 `mcp__<server>__<tool>` —— 平台核心，随机误分类（高频）
- **命名**：`mcp__gmail__search_threads`、`mcp__google_calendar__create_event`、`mcp__chrome-devtools__take_screenshot`、`mcp__context7__query-docs` …
- **output**：`McpOutput = string | {type,...}[] | {...}`（自由结构）
- **当前**：`categoryOf` 按**子串**乱命中：
  - `...__search_files` / `...__search_threads` → SEARCH 卡（把 MCP 调用画成"搜索"）
  - `...__create_event` / `...__create_draft` → fileEdit "Edit" 卡
  - `...__read_file_content` → fileRead "Read" 卡（路径空）
  - `...__take_screenshot` / `...__list_events` / `...__get_thread` / `...__click` → null → `PlainToolView` 原始 JSON
- **丑陋点**：MCP 是本平台核心卖点，却没有任何一致渲染——同一个 MCP server 的不同方法会散落成 command/edit/search/raw 四种外观，且图标/语义全错。
- **建议**：
  1. 在 `categoryOf` **之前**先识别 `name.startsWith("mcp__")`，解析出 `server` / `tool` 两段，渲染统一的 **MCP 卡**：plug 图标 + `server · tool` 标题 + 参数摘要 + 结果（文本/JSON/或结构化 content blocks 富渲染）。
  2. 进阶：给本平台自己管理的 composio/内置 MCP server 建**按 server+tool 名的富渲染注册表**（类似 `TOOL_RESULT_RENDERERS`），把本地 feed 也接上 `cloudToolRegistry` 式的机制。
- **优先级**：**P0**（先做统一 MCP 卡 + 阻断误分类）

### G3 · `WebFetch` —— 完全没处理（中高频）
- **input**：`{ url, prompt }`
- **output**：`{ url, code, codeText, bytes, durationMs, result }`（result = 对页面跑 prompt 后的文本）
- **当前**：null → `PlainToolView` 原始 JSON。且不被任何正则命中（"fetch" 不在任何 RE 里——见 §3 漏分）。
- **建议**：链接图标 + 显示 host/url（可点，`rel="noopener"`）+ HTTP 状态码 chip + 折叠展示 `result`（markdown）。
- **优先级**：**P1**

### G4 · `WebSearch` —— 部分渲染，源列表丢失（中频）
- **input**：`{ query, allowed_domains?, blocked_domains? }`
- **output**：`{ query, results: ({tool_use_id, content:{title,url}[]} | string)[], durationSeconds, searchCount }`
- **当前**：工具名含 "search" → Search 卡，只显示 `searchQuery`（query），**结果里的 title/url 源列表掉进原始 output pre**。
- **建议**：搜索图标 + query 标题 + `searchCount` + 渲染 **源列表**（每条 title 链接 + 域名），复用类似 finance-genui 的 list 卡。
- **优先级**：**P1**

### G5 · `ReportFindings` —— 假阳性（中频，代码审查场景）
- **input**：`{ level?, findings: {file, line?, summary, failure_scenario, category?, verdict?, outcome?}[] }`
- **当前**：工具名含 "find" → SEARCH 卡，searchQuery 为空 → 一张空的"Search"卡。
- **建议**：审查结果专用卡——按 severity 排序的 findings 列表，每条 `file:line` + summary + failure_scenario + verdict/outcome 徽章。
- **优先级**：**P1**（在跑 `/review`、code-review 时高度可见）

### G6 · 图片 / PDF 读取与 Bash 图片输出 —— 不渲染媒体（中频）
- **来源**：`FileReadOutput` 有 `type:"image"`（base64+mime+dimensions）/`type:"pdf"`（base64）/`type:"parts"`；`BashOutput.isImage`。
- **当前**：Read 卡的 `computeOutput` 把它当文本 → 展开看到 base64/结构化对象的原始文本。
- **建议**：`type:"image"` → 渲染 `<img>`（data URI，`max-w-full`）；`type:"pdf"`/`parts` → PDF 链接/页数徽章（可复用 `PdfLink`）。
- **优先级**：**P2**

### G7 · `Artifact` —— 完全没处理（中频，产出物）
- **input**：`{ file_path, favicon, description?, label?, url? }`；**output** 含发布后的 artifact URL。
- **当前**：null → `PlainToolView`。
- **建议**：favicon emoji + 标题 + description + **可点的 artifact URL**（发布成功的可视化页面是用户要看的交付物）。
- **优先级**：**P2**

### G8 · 后台任务 / 长驻类：`TaskOutput` · `TaskStop` · `Monitor` · `REPL`（低中频）
- `TaskOutput`（`{task_id, block, timeout}`）：后台任务轮询——建议关联到发起它的 Bash `backgroundTaskId`，显示为"后台任务输出"。
- `TaskStop`（output `{message, task_id, task_type, command}`）：显示"已停止 <command>"一行。
- `Monitor`（`{description, command|ws, timeout_ms, persistent}`）：长驻监视——状态徽章 + 描述 + 事件流。
- `REPL`（`{code, description}`）：代码卡（复用 Bash 卡风格，语言=js）+ 输出。
- **优先级**：**P3**（各自低频，可打包一批做）

### G9 · 其余长尾（低频，多数只需阻断误分类 + 通用卡够用）
`EnterPlanMode`、`ListMcpResources`、`ReadMcpResource(Dir)`、`Workflow`、`CronCreate/Delete/List`、`ScheduleWakeup`、`RemoteTrigger`、`EnterWorktree/ExitWorktree`、`ClaudeDesign`、`Projects`、`PushNotification`。
- 多数落 `PlainToolView` 即可接受；`CronCreate`（误命中 fileEdit）、`ReadMcpResource*`（误命中 fileRead、路径空）属"假阳性但危害小"。
- **优先级**：**P4**（随 §3 的 `categoryOf` 重构一并消除误分类即可，不必逐个做专门卡）

---

## 3. 正则匹配的假阳 / 假阴清单

`categoryOf` 只看**工具名子串**，产生以下错误：

**假阳性（错误命中，画错卡）**：
| 工具名 | 误命中 | 原因 | 后果 |
|---|---|---|---|
| `TodoWrite` | fileEdit | 含 "write" | 空路径 Edit 卡（G1） |
| `WebSearch` | search | 含 "search" | 只显示 query，丢源列表（G4） |
| `ReportFindings` | search | "findings" 含 "find" | 空 Search 卡（G5） |
| `CronCreate` | fileEdit | 含 "create" | 误画 Edit 卡 |
| `NotebookEdit` | fileEdit | 含 "edit" | 无 diff（但 filePath 侥幸命中 notebook_path）|
| `ReadMcpResource(Dir)` | fileRead | 含 "read" | Read 卡路径空 |
| `mcp__*__create_*` | fileEdit | 含 "create" | MCP 调用画成 Edit（G2） |
| `mcp__*__search_*` | search | 含 "search" | MCP 调用画成 Search（G2） |
| `mcp__*__read_*` | fileRead | 含 "read" | MCP 调用画成 Read（G2） |

**假阴性（应识别却漏掉，掉通用卡）**：
| 工具名 | 应归类 | 现状 |
|---|---|---|
| `WebFetch` | 应有 fetch/web 类 | null → 原始 JSON（G3）|
| `Artifact` | 应有专门卡 | null（G7）|
| `mcp__*__take_screenshot` / `list_*` / `get_*` / `click` … | 应归 MCP 类 | null（G2）|

**根因**：分类应基于**结构 + 精确名单**而非模糊子串。建议把 `categoryOf` 重构为：先 `mcp__` 前缀短路 → 再对内置工具用**精确名映射表**（`Bash→command`、`Read→fileRead`…）→ 才 fallback 到子串启发式（保留对 codex/opencode 等其它 CLI 动态名的兼容）。

---

## 4. 建议实施批次

**批次 A（P0，阻断最难看的高频错误）—— ~1.5 天**
- A1 `categoryOf` 重构：`mcp__` 前缀短路 + 内置工具精确名表（顺带消掉 §3 全部假阳/假阴）。
- A2 `TodoWrite` 拦截 → 复用 `<TodoList>`（G1）。
- A3 统一 **MCP 卡**（plug 图标 + `server · tool` + 参数/结果）（G2 第一步）。

**批次 B（P1，高可见富渲染）—— ~2 天**
- B1 `WebFetch` 卡（G3）
- B2 `WebSearch` 源列表卡（G4）
- B3 `ReportFindings` 审查结果卡（G5）

**批次 C（P2，媒体与交付物）—— ~1.5 天**
- C1 图片/PDF 读取 + Bash 图片输出（G6）
- C2 `Artifact` 卡（G7）

**批次 D（P3–P4，长尾）—— ~1.5 天**
- D1 后台任务/长驻类：`TaskOutput`/`TaskStop`/`Monitor`/`REPL`（G8）
- D2 MCP 富渲染注册表（G2 第二步）：把本地 feed 接上按 `server+tool` 的结构化渲染（Gmail 线程、日历事件、Drive 文件、chrome-devtools 快照/截图等）。
- D3 剩余长尾靠 A1 消除误分类后维持通用卡即可。

---

## 5. 三类划分总表

**(a) 真缺口，要补**：`TodoWrite`(G1)、MCP 工具(G2)、`WebFetch`(G3)、`WebSearch`(G4)、`ReportFindings`(G5)、图片/PDF(G6)、`Artifact`(G7)、后台/长驻类(G8)。§3 的所有假阳/假阴也算缺口（多为误分类）。

**(b) 通用卡/现状已够，不值得专门做**：`Write`（fileEdit 卡够用）、`Glob`/`Grep`（Search 卡够用）、`EnterPlanMode`、`ListMcpResources`、`Cron*`、`ScheduleWakeup`、`RemoteTrigger`、`EnterWorktree`/`ExitWorktree`、`ClaudeDesign`、`Projects`、`PushNotification`（消除误分类后 `PlainToolView` 可接受）。

**(c) 内部噪声，本就不该渲染**：`system` 的 hooks/thinking_tokens/api_retry、`stream_event` 非 text/thinking bookkeeping、`user` 帧的 text/thinking（SDK 注入的子代理 echo）、`ShowOnboardingRolePicker`、未知 status（白名单外静默吞）。这些当前均已正确丢弃。

---

## 6. 总体判断

覆盖度**不算全**。核心 6 件套（Bash/Read/Edit/Write/Glob/Grep）+ 子代理 Task + Task* 任务列表 + 审批/提问 覆盖良好，但：

- **一个纯子串正则**在承担分类职责，对新一代工具名和 **MCP 工具**大面积误分类——这是最系统性的问题。
- **本地 feed 没接富渲染注册表**，凡 `categoryOf` 未识别的一律掉原始 JSON。
- 高频的 `TodoWrite`、平台核心的 **MCP 工具**、常见的 `WebFetch`/`WebSearch`/`ReportFindings` 都存在真缺口。

**Top 5 最该补**：
1. `categoryOf` 重构（`mcp__` 短路 + 精确名表），一次性消除 §3 全部误分类。
2. **MCP 工具统一卡**（平台核心功能，当前最混乱）。
3. `TodoWrite` → checklist（最高频、当前最难看的假阳）。
4. `WebFetch` 专门卡。
5. `WebSearch` 源列表 + `ReportFindings` 审查卡。
</content>
</invoke>

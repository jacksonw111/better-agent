# Local Agent 工作台实施计划（路由分离 + claudecodeui 前端交互移植）

> 第三轮。前两轮见 [`local-agent-plan.md`](local-agent-plan.md)、[`local-agent-refactor-plan.md`](local-agent-refactor-plan.md)（R0–R5 已完成）。
> 本轮输入：[`research/2026-07-13-claudecodeui-comparison.md`](research/2026-07-13-claudecodeui-comparison.md) + [`research/2026-07-13-claudecodeui-frontend-inventory.md`](research/2026-07-13-claudecodeui-frontend-inventory.md)。
> 两条硬约束：① **local agent 与 cloud agent 路由分离**，local 独立路由树；② **不破坏现有 cloud agent 任何功能**——每期交付都带 cloud 回归清单。

---

## 0. 现状与目标形态

**现状**：`/agents` 是 cloud+local 合并表；local 聊天挂在 `/chat?localAgentId=<tokenId>`（`chat.tsx:290` 分支渲染 `LocalChatPanel`）；`/local-agents/*` 只是重定向壳。

**目标**：

```
/agents            → 仅 cloud agent（现有功能原样）
/chat              → 仅 cloud chat（删 localAgentId 分支，旧链接 301 到新路由）
/local             → local agent 工作台入口：agent 列表 + 连接引导
/local/$tokenId    → 单 agent 工作台：会话侧栏 + 多 tab 内容区（chat 起步，后续 files/git/shell tab）
                     会话经 ?session= 选中（沿用现有 session picker 语义）
```

组件边界：`components/bridge/*` 本就是 local 专用，整体归属 `/local` 路由树；**工具渲染层是云/本地共享的同一套组件**（既有纪律，见 lint/design 备忘），注册表化时两边同步吃到、保持无边框设计语言（tint+圆角+间距，零 border 零 ring）。

---

## P0 · 路由分离（护栏期，先行独立交付）

**任务**
1. 新建 `routes/local.index.tsx`（local agent 列表 + ConnectionGuide 入口）与 `routes/local.$tokenId.tsx`（迁入 `LocalChatPanel`，`?session=` 透传）。
2. `chat.tsx`：删 `localAgentId` search param 与分支；加兼容重定向 `beforeLoad`：`/chat?localAgentId=x` → `/local/x`。
3. `local-agents.*` 两个壳改指 `/local/*`；`/agents` 的 `UnifiedAgentList` 拆回 cloud-only（local 行与类型徽章移除，local 列表组件进 `/local`）。
4. 导航/dock：local 入口独立成项，不再混在 agents 里。

**验收**
- cloud 回归：`/chat` 新建/继续 cloud 会话、genui 渲染、`/agents` CRUD 全部原样。
- `/local/x` 完整复现今天 `/chat?localAgentId=x` 的全部功能（能力握手控件、审批、用量等零回归）。
- 三条旧链接（`/chat?localAgentId=`、`/local-agents`、`/local-agents/$tokenId`）都落到正确新页。

**改动面**：仅 `apps/web/src/routes/*` + 列表组件拆分；不动 server/CLI。

---

## P1 · 消息区重构（纯前端，参照 inventory §3）

**任务**
1. **工具渲染注册表**（参照 `toolConfigs.ts` 形态，吃我们的归一化 `tool` 事件）：
   - `TOOL_CONFIGS: Record<toolName, {input, result}>`，`input.type ∈ one-line | collapsible | plan | hidden`，`result ∈ hidden | hideOnSuccess | special`；未注册回退 Default；**成功可隐、错误必显**。
   - 内容渲染器 8 种：diff / markdown / file-list / todo-list / task / question-answer / text / success-message（diff、todo 已有实现，收编进注册表）。
   - 云/本地同一套：cloud chat 的工具卡同步切到注册表，视觉零变化（无边框语言不动）。
2. **消息树打磨**：连续同名工具 ≥2 折叠成组行（前 2 条预览 +N more；reasoning 不打断连续段）；消息稳定 key（意向 key+出现序号，历史 prepend 不跳动）。
3. **Bash 命令卡**：`$` 前缀、输出内联、晚到输出只自动展开一次、行数/copy/运行中 spinner。
4. **Subagent 折叠卡**：claude Task 工具 → 紫色左条 + "Currently: {tool}" 实时指示 + 工具历史 + 结果 clamp。
5. **计划审批内联**：claude plan mode 的 ExitPlanMode 审批不进 banner，内联在计划卡底部 Revise / Build(⌘↩)。
6. **QuestionCard → 分步向导**：多问题进度点、数字键 1-9/0=Other/Enter/Esc、Other 内联输入（现有 opencode QuestionCard 升级，pi extension_ui 复用同壳）。
7. ~~`interactive_prompt` 琥珀选项卡~~ **移到 P4**：我们的归一化 wire 上没有 interactive_prompt 事件（pi 的对话框已是 extension_ui 表单卡）；CLI 文本菜单解析需要 CLI 侧先产出该事件，与 P4 的 CLI 通道一起做。
8. ActivityIndicator：shimmer 动作词轮换 + 计时 + Stop(esc)。

**验收**：四 agent 各跑一轮真实会话，工具卡形态符合注册表定义；cloud chat 工具渲染回归无视觉 diff；2000 事件长会话滚动无卡顿。

---

## P2 · 工作台骨架（纯前端 + 轻 server）

**任务**
1. **会话侧栏**（参照 inventory §2）：agent(token)→session 两级；运行中/需关注脉冲点（琥珀=待审批、绿=活跃）；processing 转圈；"Load more" 分页；内联重命名壳（落库在 P3）。
2. **多 tab 内容区**：`/local/$tokenId` 内 chat tab 保活（block/hidden），预留 files/git/shell tab 位（P4 填充）；tab 药丸组可横向滚动。
3. **⌘K 命令面板**（cmdk）：先做 导航（切 agent/session/tab）+ 设置直达 + 会话名搜索；多级页面栈架子搭好，files/commits 子页留 P4。
4. **QuickSettings 快捷面板**：showThinking / showRawParameters / sendByCtrlEnter / 主题（读写现有偏好存储）。
5. **Composer 打磨**：Tab 键循环权限模式；slash 菜单按使用频次排序（localStorage）；忙时队列卡可编辑/删除（现有 queue chip 升级，发送时快照 options）。

**验收**：手机 + 桌面全流程可用；cloud chat 不受影响（composer/侧栏改动仅在 local 树内）。

---

## P3 · server API 扩展（云端，含图片端到端）

**任务**
1. **会话管理落库**：`bridge_sessions` 加 `name` / `archived_at` / `starred`（`db:migrate`，共享 DB 纪律）；oRPC 路由 rename/archive/restore/delete(hard)；侧栏三选项删除流（归档/永久删除/取消）+ archived 视图。
2. **图片输入端到端**：web 粘贴/拖拽/选择 → 上传对象存储（≤5MB，类型白名单）→ `text` 命令带 `images[]` → CLI 下载注入（claude content-block 先行，codex/opencode 按能力握手门控，pi 的 `prompt.images` 支持）。能力握手加 `images: boolean`。
3. **Web Push**：VAPID + 订阅表 + SW；三事件：需审批 / 回合完成 / 错误；通知点击深链 `/local/$tokenId?session=`。
4. **用量 modal**：TokenUsageSummary 点开 cost/status 视图（数据已全，纯装配）。

**验收**：重命名/归档跨设备一致；图片在 claude 真机端到端；锁屏收到审批推送并能一键跳回。

---

## P4 · bridge CLI 新通道（成本大头，按价值排序）

> 新命令族均走既有 WS 双工命令通道 + 能力握手门控；**所有 fs/git/shell 操作限制在 agent 工作区（cwd）内**，路径穿越校验在 CLI 侧。

**任务（按序）**
1. **多 provider 历史会话索引**：CLI 侧加 codex/opencode/pi 落盘会话解析器（对照 claudecodeui 的四家解析器实现），`listSessions` 四家补齐；补会话摘要/消息数。
2. **runShell 带外命令 + standalone 终端**：新命令 `runShell{command}`（pi `bash` / opencode `/shell` / 其余 CLI 侧 spawn）；输出以 tool 事件流回显；先做一次性命令卡，交互式 pty tab（xterm ⇄ relay WS 转发）作为二期，验证传输量后再放开。
3. **文件树（只读先行）**：`fsList` / `fsRead` 命令 → files tab 只读树 + 预览；@文件引用下拉、Read/Edit 工具卡点击打开。写操作/上传不做（agent 自己会改文件）。
4. **git 面板最小集**：`gitStatus` / `gitDiff` / `gitCommit`（AI 生成 commit message 走云端模型）；stage/branch 操作二期。
5. **跨会话全文搜索**：CLI 侧 ripgrep（依赖 1 的索引），结果流式回传，侧栏 conversations 模式 + ⌘K sessions 子页。

**验收**：每项四 agent 真机冒烟；能力握手未声明的 agent 不渲染对应 tab/控件；工作区外路径一律拒绝。

---

## P5 · 增强与收尾

1. provider 登录内嵌终端（依赖 P4-2 pty）：web 上跑 `claude /login` 等。
2. 语音输入：云端 STT（不走本机代理）。
3. 审批重投打磨：web 重连/重订阅时 server 回传 pending approvals 重投（对照它 `chat_subscribed.pendingPermissions`；我们事件已落库，做只读重放即可）。
4. 响应式终审 + 长会话虚拟化评估。

**明确不做**：TaskMaster、PRD 编辑器、插件系统、Electron、browser-use 面板（CUA/VNC 已覆盖）。

---

## 执行纪律

- 顺序 P0 → P5，每期独立可交付可部署（dev 分支 → Workers test → 真机验证 → merge main）。
- SDD 执行（fresh implementer + 审查门 + 全分支终审）；bridge 目录提交纪律不变（只暂存自己文件）。
- **每期 cloud 回归清单**：cloud chat 收发/genui/审批、/agents CRUD、dashboard 用量——任何一项异动即阻断合并。
- 工具渲染共享层的改动（P1-1）必须双端截图对比后再合。

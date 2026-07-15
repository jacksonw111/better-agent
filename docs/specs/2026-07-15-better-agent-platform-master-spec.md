# Better Agent 平台总规格

日期：2026-07-15  
状态：已根据产品讨论整理，等待最终确认

## 1. 文档目的

本文定义 Better Agent 的整体产品方向、第一版边界、核心领域模型、Computer-first 架构、Task 创建与启动流程、GitHub 开发流程，以及未来 Agent 协作的演进方式。

本文是总规格。更细的交互、技术设计和实施计划应从本文拆分，不应在实施过程中重新定义这里已经确认的产品概念。

## 2. 产品定义

Better Agent 是一个个人使用的本地 Agent 协作与远程执行平台。

用户在自己的多台 Computer 上安装 Better Agent Client。Client 发现本机已经安装的 Agent Runtime，例如 Claude Code、Codex、OpenCode 和 Pi，并让这些 Runtime 可以从 Better Agent Web 中被选择和启动。

用户创建的最小工作单元是 Task：

- Task 可以是 GitHub 仓库开发任务，例如根据 GitHub Issue 修改代码并交付 Pull Request。
- Task 也可以是普通 Computer 任务，例如整理照片、处理文件或完成不依赖 GitHub 的本地工作。
- Task 不需要先属于 Project。
- 第一版中，一个 Task 只有一个用户与一个 Agent Runtime 的对话。

Better Agent 负责连接 Computer、组装 Task 上下文、选择执行位置、启动 Runtime、传递消息并记录执行状态。Agent Runtime 继续负责自己的工具、命令策略、审批机制、浏览器或桌面能力以及原生权限行为。

## 3. 第一性原则

### 3.1 Task 是产品的最小单位

用户从 New Task 开始工作，而不是先创建 Project、团队、Squad 或 Agent 工作流。

一个 Task 必须可以独立创建、启动、对话、失败、重试和完成。

### 3.2 Computer 必须先于 Agent Run 存在

Better Agent Client 启动后代表一台 Computer 持续连接 Server。它不能像当前 bridge 一样，在进程启动时就必须启动一个 Agent session。

Agent Runtime 只在用户启动 Task 后才运行。

### 3.3 Description 是用户请求的核心

Better Agent 可以添加 GitHub、Workspace、Skill 和工具环境上下文，但不能覆盖、改写或弱化用户原始 Description。

### 3.4 Better Agent 不重新定义 Runtime 权限

Task Workspace 是工作目录和隔离工作副本，不是 Better Agent 的权限边界或安全沙箱。

Claude Code、Codex、OpenCode、Pi 等 Runtime 使用各自原生的权限、命令、审批和工具策略。Better Agent 只转发这些交互，不建立统一的命令许可层。

### 3.5 真实工具结果优先于预检查

Better Agent 不在每次 Task 启动前主动运行 `gh auth status` 或其他工具健康检查。

平台只告诉 Agent 已知的环境事实，例如 `gh` 已安装。Agent 真正使用工具时产生的输出或错误才是事实来源，Agent 可以使用自己的能力诊断或修复。

### 3.6 GitHub 负责需求与交付，Better Agent 负责执行

对于软件开发：

- GitHub Issue 是持久需求记录。
- Better Agent Task 是执行与对话记录。
- GitHub Pull Request 是代码交付、Review、CI 和 Merge 记录。

Better Agent 不复制一套 Issue Tracker 或 Code Review 系统。

## 4. 产品范围

### 4.1 第一版包含

- 一位用户管理自己的多台 Computer。
- 每台 Computer 运行一个持续连接的 Better Agent Client。
- Client 发现支持的 Agent Runtime 和它们的 Skill Inventory。
- Client 报告 Better Agent 管理的默认 CLI 工具，例如 `git` 和 `gh`。
- 用户通过三步 New Task Wizard 创建并启动 Task。
- Task 可以有或没有 GitHub Repository。
- Repository 存在时可以关联多个 GitHub Issue。
- 每个 Task 选择一台在线 Computer 和一个 Agent Runtime。
- 一个 Task 启动一个 Run，并进入一对一 Task Conversation。
- Repository Task 使用复用缓存和隔离 Task Workspace。
- Stand-alone Task 使用干净的托管 Task 目录作为启动目录。
- Runtime 的原生审批、输入、输出、工具调用和重启能力继续通过现有 session relay 工作。

### 4.2 第一版不包含

- 团队账号、组织角色、共享 Computer 或跨用户权限。
- Task 内的多个 Agent、Supporting Agent、Squad 或 Agent-to-Agent Chat。
- 自动派发图、Worker Graph 或多 Agent Workbench。
- 必须先创建的 Project。
- 离线 Computer 的延迟队列、定时 Task 或重连后自动启动。
- 独立 Review 页面。
- 每次 Task 启动前的工具认证或环境健康门禁。
- Better Agent 自定义的 Runtime 命令策略、文件权限或沙箱。
- 自动读取全部 Issue 评论并放入初始 Prompt。
- 在第一版 Wizard 中远程浏览 Computer 的任意本地目录。

### 4.3 后续演进

- Repository Task 的完整 Issue → Draft PR → Review → Merge 生命周期。
- Task 的顺序 Run、失败重试和跨 Runtime 接续。
- 可选 Project 作为相关 Task 的分组视图，而不是 Task 的前置条件。
- 通过文档、Issue 和结构化结果进行 Agent handoff。
- 在共享 Task timeline 和独立 Run Workbench 基础上的多 Agent 协作。

## 5. 系统组成

### 5.1 Web Application

Web 是用户创建 Task、选择 Computer 和 Runtime、查看 Task Conversation、观察 Run 状态以及访问 GitHub 上下文的主界面。

Web 不直接连接或启动本地 Runtime。所有本地动作都通过 Server 和对应 Better Agent Client 完成。

### 5.2 Server

Server 负责：

- 用户身份与所有权。
- Computer、Task、Run 和 Conversation 的持久化。
- Pairing Token 的验证。
- Computer 在线状态。
- Server-side GitHub Connection。
- Repository 和 Issue 搜索及 Issue 快照。
- Task Start Context 的标准部分。
- 向指定 Computer 发送幂等的 Run Launch Command。
- Task、Run、GitHub 和 Conversation 状态同步。

### 5.3 Better Agent Client

Better Agent Client 安装在用户 Computer 上，作为后台服务持续运行。

它负责：

- 与用户账号 Pairing。
- 保持 Computer 级连接与心跳。
- 发现 Agent Runtime。
- 报告 Runtime Inventory、Skill Inventory 和 Installed Tool Summary。
- 接收 Server 发出的 Run Launch Command。
- 准备 Repository Cache 和 Task Workspace。
- 在指定 Task Workspace 启动选定 Runtime。
- 通过现有 session relay 传递 Runtime 输入、输出和原生交互。
- 为 Task Start Context 添加本地 Workspace 和工具事实。

### 5.4 Agent Runtime

Agent Runtime 是用户本机已经安装的执行产品，例如：

- Claude Code
- Codex
- OpenCode
- Pi

Runtime Adapter 负责原生启动、消息输入、事件规范化、审批、工具状态、终止和恢复能力。不同 Runtime 的能力可以不同，Better Agent 必须真实展示差异，不能伪装成完全一致。

### 5.5 GitHub

GitHub 是 Repository Task 的需求与交付系统。

Server-side GitHub Connection 用于：

- 搜索和选择 Repository。
- 搜索和读取 Issue。
- 获取 Issue 快照。
- 后续读取 Pull Request、Review 和 CI 状态。

Computer 上的本地 `gh` 用于 Agent Runtime 的实际 GitHub 操作。Server 的 GitHub 凭据永远不能复制到 Computer，本地 `gh` 凭据也不能上传到 Server。

## 6. 核心领域模型

### 6.1 Computer

Computer 是用户控制并与 Better Agent 注册的一台电脑。

Computer 具有稳定身份，并记录：

- 所有者。
- 显示名称。
- 操作系统与架构。
- Better Agent Client 版本。
- 最近心跳时间和连接状态。
- Runtime Inventory。
- 每个 Runtime 的 Skill Inventory。
- Installed Tool Summary。

Computer 离线后仍保留并显示，但不能启动新的 Run。

### 6.2 Better Agent Client

Client 是 Computer 上的平台进程，不是 Agent Runtime，也不是某个 Task 的 Run。

一个 Client 可以在生命周期内执行多个 Task。Client 重启不应创建新的 Computer；重新注册只更新同一个 Computer 的状态和 Inventory。

### 6.3 Agent Runtime

Agent Runtime 是 Computer 上可以执行 Task 的 Agent 产品。

Runtime 必须来自该 Computer 当前上报的 Runtime Inventory。用户切换 Computer 后，如果原 Runtime 不存在，Wizard 必须清除该选择。

### 6.4 Skill Inventory

Skill Inventory 是选定 Runtime 在选定 Computer 上可用的 Skill 列表。

它不是全局 Skill Marketplace，也不是自动注入列表。

### 6.5 Skill Palette

Skill Palette 是用户在当前 New Task Wizard 中勾选的 Skill 子集。

它只控制 Description 编辑器的 `/` 自动补全：

- 勾选 Skill 不会把 Skill 发给 Agent。
- 勾选 Skill 不会自动插入 Description。
- 勾选 Skill 不会自动激活 Skill。
- Wizard 不保存一个隐藏的 selected-skills 指令列表。

### 6.6 Skill Reference

Skill Reference 是用户明确插入 Description 的文本，例如 `/research`。

只有 Description 中真实存在的 Skill Reference 才会在启动时解析。可以包含多个引用，并保留它们在原始 Description 中的位置和周围语义。

未知或未选中的 `/text` 保持普通文本，不触发隐藏行为。

### 6.7 Task

Task 是用户创建的持久工作单元。

Task 记录：

- Task Name。
- 原始 Task Description。
- 所有者。
- 选定 Computer。
- 选定 Agent Runtime。
- 可选 GitHub Repository。
- 有序 Linked GitHub Issue 快照。
- Task Opening Message。
- Task Conversation。
- 一个或多个顺序 Run。

第一版创建 Task 时立即创建并尝试启动第一个 Run。

### 6.8 Task Name

Task Name 是人类界面标签，用于：

- Task 列表。
- 导航和搜索。
- Task Conversation 标题。

Task Name 不重复进入 Agent 的初始指令。

### 6.9 Task Description

Task Description 是用户要求 Agent 完成什么的主要指令，不能为空。

它必须原样保存。Better Agent 生成的上下文只能围绕它增加信息，不能替换它。

### 6.10 Run

Run 是一个 Agent Runtime 在一台 Computer 上对一个 Task 的一次连续执行。

Run 记录：

- Task。
- Computer。
- Agent Runtime。
- Task Workspace 标识。
- Runtime session 标识。
- Launch Command 的幂等标识。
- 生命周期状态。
- 真实启动或执行错误。

Task 与 Run 必须分离。未来同一 Task 可以在不同时间有多个顺序 Run，但任何时刻最多只有一个 Run 对同一个 Task Workspace 持有写入权。

### 6.11 Task Conversation

Task Conversation 是用户和当前 Task 所选 Agent Runtime 的一对一对话。

第一条可见内容是 Task Opening Message。Workspace 准备、Repository 同步、依赖准备、Agent 进程启动等内部事件不能伪装成聊天消息。

### 6.12 Task Opening Message

Task Opening Message 是用户在聊天中看到的第一条消息。

它包含：

- 原始 Description，包括可见 `/skill` 引用。
- 可选 Repository 信息。
- 每个 Linked Issue 的标题、正文和规范 URL。
- 简洁的执行上下文，例如选定 Computer、Runtime 和 Workspace 类型。

它不包含：

- Task Name 的重复指令。
- 展开的完整 Skill 内容。
- “正在准备 Workspace”之类的生命周期文本。
- Issue 的完整评论历史。

### 6.13 Task Start Context

Task Start Context 是真正交给 Agent Runtime 的启动上下文，不等同于可见聊天文本。

它由以下部分组成：

1. 原始 Description。
2. 在原位置解析后的 Skill Reference 指令。
3. 可选 Repository 信息。
4. Linked Issue 快照。
5. Task Workspace 路径和类型。
6. Agent Environment Context。

Server 负责生成标准 Task 和 GitHub 上下文；Client 补充本地 Workspace 与工具事实，并通过 Runtime Adapter 完成 Runtime-specific Skill 解析。

### 6.14 GitHub Repository

GitHub Repository 是可选 Task 上下文，不是 Project，也不是创建 Task 的必填项。

Repository 由 Server-side GitHub Connection 选择。用户可以搜索已授权 Repository，也可以粘贴 GitHub URL 定位。

### 6.15 Linked GitHub Issue

Linked Issue 只有在已选 Repository 后才能添加，并且必须属于该 Repository。

启动时保存以下快照：

- Issue number。
- Title。
- Body。
- Canonical URL。

评论不进入初始上下文。如果最新讨论重要，Agent 使用本地 `gh` 获取。

Wizard 允许添加多个 Linked Issue。对于代码交付，推荐一个独立可交付 Issue 对应一个 Task 和一个 Pull Request；额外 Linked Issue 默认是参考上下文，Better Agent 不擅自为它们生成关闭语义。

### 6.16 Repository Cache

Repository Cache 是每台 Computer 上由 Client 管理的可复用 Repository 与环境准备数据。

它按 Repository identity 建立，而不是按 Project 建立。它用于避免：

- 每个 Task 重复 clone 同一 Repository。
- Repository 未变化时重复下载相同依赖。
- 多个 Task 共享一个有未提交修改的工作目录。

### 6.17 Task Workspace

Repository Task 从 Repository Cache 创建独立 Task Workspace。不同 Task 不共享未提交的代码修改。

Stand-alone Task 创建干净的托管 Task 目录作为启动位置。

Task Workspace 只是 Runtime 的起始工作目录和 Task 文件隔离机制。Better Agent 不阻止 Runtime 根据自己的原生权限访问其他资源，因此它也能够处理“整理照片目录”一类 Computer Task。

## 7. Client 安装与 Pairing

### 7.1 安装流程

安装 agent-cli 时：

1. 检查本机已安装的支持 Runtime。
2. 展示 Claude Code、Codex、OpenCode、Pi 等检测结果。
3. 允许用户选择安装缺失的支持 Runtime。
4. 检查 Better Agent 管理的默认 CLI 工具 `git` 和 `gh`。
5. 对缺失工具提供安装选项。
6. `gh` 安装后可以引导用户执行原生 `gh auth login`，但登录不是 Pairing 条件。
7. 引导用户将 Client Pair 到 Better Agent 账号。
8. 安装或启动后台服务。

### 7.2 Pairing

Pairing 将一个 Client 和 Computer 绑定到用户账号。

Pairing 凭据：

- 只用于 Better Agent Client 与 Server 通信。
- 不等于 Runtime 登录。
- 不等于 GitHub Connection。
- 不携带 Server-side GitHub 凭据。

### 7.3 持续连接

Client 启动后：

- 注册或更新同一个 Computer。
- 上报 Inventory。
- 保持心跳或 Computer control connection。
- 不启动任何 Agent Runtime。
- 等待 Server 的 Run Launch Command。

Server 根据最近心跳或连接状态计算 Connected/Offline。离线 Computer 仍在 UI 中可见。

## 8. New Task 用户流程

### 8.1 入口

用户点击全局 `New Task`，打开三步 Wizard。

固定顺序：

1. Runtime
2. Request
3. GitHub

没有 Review 页面。

### 8.2 Step 1：Runtime

字段和行为：

1. 选择已经配置的 Computer。
2. Computer 显示 Connected 或 Offline。
3. 选择 Computer 后，显示该 Computer 上检测到的 Agent Runtime。
4. 选择 Agent Runtime 后，显示只读 Installed Tool Summary。
5. Installed Tool Summary 只包含 Better Agent 管理的默认工具，例如 `git`、`gh`，不扫描展示所有可执行文件。
6. 选择 Agent Runtime 后，显示它的 Skill Inventory。
7. 用户可以勾选多个 Skill，形成当前 Wizard 的 Skill Palette。

依赖规则：

- Computer 是 Agent Runtime 的上游选择。
- 更换 Computer 时，不兼容的 Agent Runtime 必须清空。
- 更换 Agent Runtime 时，Skill Palette 必须根据新的 Skill Inventory 重置。
- Offline Computer 可以查看，但不能启动新 Run。
- 工具认证状态不是 Start 门禁。

### 8.3 Step 2：Request

字段：

- Task Name，必填。
- Task Description，必填。

Description 编辑器支持 `/` 自动补全：

- 候选项只来自 Step 1 的 Skill Palette。
- 选择候选项会在当前光标位置插入 `/skill-name`。
- 可以插入多个 Skill Reference。
- 勾选 Skill 本身不会修改 Description。

### 8.4 Step 3：GitHub

字段：

- GitHub Repository，可选。
- Linked GitHub Issues，可动态添加和删除，可选。

规则：

- 没有 Repository 时，Issue 控件禁用。
- Issue 必须来自选定 Repository。
- Repository 和 Issue 都为空时仍可 Start。
- Repository 搜索使用 Server-side GitHub Connection。
- Repository 输入支持搜索和粘贴 URL。

最终操作是 `Start`，不再增加 Review 或确认步骤。

### 8.5 Start 的原子行为

点击 Start 后，Server：

1. 验证 Task Name 和 Description。
2. 验证 Computer 所有权和在线状态。
3. 验证 Runtime 来自该 Computer 的 Inventory。
4. 验证 Repository 和 Issue 的所属关系。
5. 获取 Linked Issue 的 title、body 和 URL 快照。
6. 创建 Task。
7. 创建第一个 Run。
8. 保存 Task Opening Message。
9. 生成 Launch Command。
10. 幂等发送给选定 Computer。
11. 打开 Task Conversation。

第一版不为离线 Computer 排队。Computer 在 Start 前离线时，Start 失败并要求用户重新选择或重试。

## 9. Run 启动流程

### 9.1 Computer control channel

Run 启动必须使用 Computer 级 control channel，因为点击 Start 时还没有 Agent session。

Launch Command 至少包含：

- Task ID。
- Run ID 和幂等键。
- Agent Runtime。
- Workspace intent：Repository-backed 或 Stand-alone。
- Repository identity。
- Linked Issue 快照。
- 原始 Description。
- 生成 Task Start Context 所需的标准信息。

同一个 Run ID 即使因重连重复投递，也只能启动一个 Runtime 进程。

### 9.2 Workspace 准备

Repository-backed Run：

1. Client 查找 Repository Cache。
2. Cache 不存在时 clone；存在时同步所需 refs。
3. 根据 Repository 和环境准备版本判断依赖是否可复用。
4. 创建独立 Task Workspace。
5. 为开发 Task 准备独立 branch。

Stand-alone Run：

1. 创建干净托管 Task 目录。
2. 将该目录作为 Runtime 启动目录。

依赖复用必须按 Repository 和相关 setup/environment version 失效。不能为了复用而让不同 Task 共用同一个可写工作目录。

### 9.3 Runtime 启动

Client：

1. 选择对应 Runtime Adapter。
2. 解析 Skill Reference。
3. 添加 Workspace 和 Agent Environment Context。
4. 在 Task Workspace 启动 Runtime。
5. 建立现有 session relay。
6. 将 runtime session identity 绑定到 Run。

此后用户输入、Runtime 输出、审批和控制继续使用现有 session 级传输。

## 10. Task Opening Message 与 Agent 指令

### 10.1 可见消息模板

Task Conversation 的第一条消息按以下逻辑组装：

```markdown
{Original Task Description，保留 /skill 引用}

## GitHub context
Repository: {repository URL；没有则省略整个区块}

### Issue #{number}: {title}
{body}
{canonical URL}

## Execution context
- Computer: {computer name}
- Agent Runtime: {runtime name}
- Workspace: {repository workspace 或 managed task directory}
```

多个 Issue 按用户添加顺序重复 Issue 区块。

模板允许根据无 Repository、无 Issue 的情况省略空区块，但不能省略原始 Description。

### 10.2 Agent-facing Task Start Context

Agent 实际收到的指令与可见 Opening Message 的差异只有必要的执行内容：

- `/skill` 在它出现的位置解析为完整 Skill 指令或 Runtime-native Skill 激活形式。
- 添加实际本地 Task Workspace 路径。
- 添加已知工具事实。

Agent Environment Context 可以表达：

```markdown
## Agent environment
- git is installed and managed by Better Agent.
- gh is installed and managed by Better Agent.
- Authentication and current health have not been preflighted; actual command output is authoritative.
```

不能把 Skill Palette、完整 Installed Software 清单、工具健康承诺或统一 Runtime 权限策略写入指令。

## 11. Task Conversation 与状态展示

### 11.1 Conversation 内容

Conversation 只显示有交流意义的内容：

- Task Opening Message。
- 用户消息。
- Agent 消息。
- Runtime 的原生审批或问题交互。
- 对用户有直接行动意义的真实错误。

以下内容属于 Run 状态，不是聊天：

- Preparing Workspace。
- Syncing Repository。
- Installing Dependencies。
- Starting Agent。
- Binding Session。
- Heartbeat。

### 11.2 Run 状态

建议状态：

- `created`
- `launching`
- `preparing_workspace`
- `starting_runtime`
- `running`
- `waiting_for_user`
- `failed`
- `stopped`
- `completed`

UI 可以在 Conversation 外显示简洁状态或错误，不应把每次状态变化写进消息历史。

### 11.3 启动失败

启动失败时：

- Task 保留。
- Task Opening Message 保留。
- Run 记录真实错误。
- UI 在消息历史外显示可行动错误。
- 用户以后可以重试新的 Run。

Better Agent 不能用推测性健康检查替代真实错误。

## 12. GitHub Issue → Task → Pull Request 目标流程

这一节定义 Repository 开发 Task 的目标最佳实践。第一版 Task 创建可以先完成 Issue 上下文和本地执行，Pull Request 生命周期可作为后续切片逐步上线。

### 12.1 权威边界

| 对象 | 权威内容 |
|---|---|
| GitHub Issue | 需求、讨论、验收标准、标签和 open/closed 状态 |
| Better Agent Task | Computer、Runtime、Workspace、Run history、Conversation 和执行错误 |
| GitHub Pull Request | 代码 Diff、Review、CI、Mergeability 和 Merge 结果 |

### 12.2 Golden path

1. 用户选择一个独立可交付的 GitHub Issue。
2. 创建一个 Repository-backed Task。
3. Client 从 Repository Cache 准备独立 Workspace 和 branch。
4. Agent 根据 Description 和 Issue 快照开始工作。
5. 有第一批有意义的修改后，使用本地 `gh` push branch 并创建 Draft Pull Request。
6. Pull Request 链接回 Issue。
7. CI 修复和 Review 反馈继续使用同一个 Task、Workspace、branch 和 Pull Request。
8. 本地验证完成后，将 Draft PR 标记为 Ready for Review。
9. GitHub repository rules、required checks 和 reviewers 决定是否可以 Merge。
10. PR Merge 后同步 Task 完成状态；PR 未合并关闭时，Task 不标记为成功交付。

### 12.3 PR 规则

- 一个独立可交付 Task 默认对应一个 branch 和一个 Pull Request。
- PR 先以 Draft 打开，不应过早暗示完成。
- 后续修复继续更新同一个 PR，不创建重复 PR。
- 只有目标为默认分支且确实希望 Merge 后关闭 Issue 时，才使用 `Closes #123` 等 closing keyword。
- Better Agent 不自动绕过 branch protection、required review、CI、merge queue 或 repository rules。
- Merge 默认由用户或 GitHub 的明确 auto-merge/merge queue 机制完成。

建议 PR Body：

```markdown
Closes #123

## What changed
- 行为层面的简短总结

## Verification
- 本地执行的检查及结果
- GitHub CI 状态

## Review notes
- 关键权衡、迁移、截图或已知限制
```

### 12.4 大 Issue 拆分

当一个 Issue 包含多个独立交付结果时：

1. Better Agent 可以提出拆分建议。
2. 必须由用户确认。
3. 确认后在 GitHub 创建 Sub-issues。
4. 每个 runnable Sub-issue 拥有自己的 Task、Workspace、branch 和 Pull Request。

Better Agent 不在内部创建一套不可见的开发 subtask hierarchy。

## 13. Stand-alone Computer Task

Stand-alone Task 不需要 Repository、Issue 或 Project。

典型场景：

- 整理照片文件夹。
- 对一批本地文件重命名或分类。
- 使用桌面或浏览器完成操作。
- 调查 Computer 上的环境问题。
- 运行不属于某个 Repository 的自动化任务。

流程仍然使用同一个 New Task Wizard：

- 选择 Computer 和 Runtime。
- 输入 Name 和 Description。
- GitHub Step 留空并 Start。

Client 创建干净托管 Task 目录作为起始目录。Description 可以说明需要处理的目标资源。Runtime 是否能够访问资源、是否需要用户批准以及如何执行，由 Runtime 的原生能力决定。

Better Agent 不把 Stand-alone Task 变成另一个特殊产品，也不为它建立单独的 Task 类型。

## 14. 多 Computer 与个人多 Agent

一个账号可以 Pair 多台 Computer，每台 Computer 可以安装不同 Runtime 和 Skill。

“个人多 Agent”表示：

- 用户可以在不同 Task 中选择不同 Runtime。
- 多台 Computer 可以同时运行不同 Task。
- 一个用户统一观察和管理这些执行。

它不表示第一版的一个 Task 内存在多个 Agent participant。

第一版禁止：

- Agent-to-Agent Chat。
- Primary/Supporting Agent 关系。
- Agent 自动派发其他 Agent。
- 多个 Agent 同时写同一个 Task Workspace。

未来协作优先使用 GitHub Issue、文档、结构化结果和显式 dispatch 作为 handoff，而不是隐藏的 Agent 私聊。

## 15. 安全与信任边界

### 15.1 所有权

Computer、Task、Run、Repository selection、Issue snapshot 和 Conversation 必须按用户隔离。

用户不能选择、启动或观察其他用户的 Computer 和 Run。

### 15.2 凭据

- Pairing Token 只用于 Client ↔ Server。
- Server-side GitHub 凭据不下发到 Computer。
- 本地 `gh` 凭据不上传 Server。
- Runtime provider credentials 保持在用户 Computer 上。

### 15.3 Launch 幂等

Launch Command 必须按 Run ID 幂等。重连、重试和重复投递不能启动第二个相同 Runtime 进程。

### 15.4 Prompt 数据

Task Description、Issue body 和其他 GitHub 文本都是不可信用户内容。

它们只能作为 Agent 上下文，不能被 Server 或 Client 当作平台配置、Shell 指令、路径授权或权限规则直接执行。

### 15.5 Runtime 权限

Better Agent 不声称 Task Workspace 限制 Runtime 只能访问该目录。

平台不替代 Runtime 自己的权限模型。任何 Runtime 原生审批都应真实呈现；不能为了统一体验而静默放行或静默拒绝 Runtime 行为。

## 16. 错误与恢复原则

- Computer Offline：保留 Computer 和 Task 数据，不自动排队启动。
- Runtime Missing：不能在该 Computer 上选择或启动该 Runtime。
- `gh` Missing：Inventory 显示事实；Repository Task 仍可以创建，实际需要 `gh` 时由真实错误处理。
- `gh` Authentication Failure：不在 Start 前拦截；将实际命令错误交给 Agent。
- Repository Sync Failure：Run 失败，Task 和 Opening Message 保留。
- Runtime Start Failure：Run 失败并显示真实错误，不生成虚假聊天消息。
- Control reconnect：按 Run ID 恢复或忽略重复 Launch。
- Session reconnect：使用现有 cursor、idempotency 和 relay 恢复机制。
- Retry：同一 Task 创建新的顺序 Run，而不是复制 Task 需求记录。

## 17. UI 信息架构

### 17.1 主要页面

- Task List：查看和进入 Task。
- Task Conversation：一对一用户/Agent 交互。
- Computers：查看 Pairing、Connected 状态、Runtime 和默认工具事实。
- Skills：管理或查看可用 Skill。
- Integrations：管理 Server-side GitHub Connection 等服务。
- Local Agent/Run inspection：保留现有 session 观察与控制能力，并逐步成为 Task 下的 Run inspection。

### 17.2 New Task

New Task 是全局主要动作。Wizard 只收集启动 Task 真正需要的上下文，不显示重复 Review，不显示无意义的 startup message，也不把 Runtime 原生配置全部搬进表单。

### 17.3 Task Conversation

Conversation 首屏应让用户立即看懂：

- 这是哪个 Task。
- 用户要求 Agent 做什么。
- 关联了哪些 Repository/Issue。
- 当前选择了哪个 Computer 和 Runtime。
- Agent 的真实回复和需要用户处理的交互。

## 18. 可观察产品契约

### 18.1 Computer 契约

- Client 不启动 Agent 也能连接。
- 同一 Pairing 重连不会创建重复 Computer。
- Runtime 和 Skill 选择来自选定 Computer 的最新 Inventory。
- Offline Computer 继续显示但不能 Start。
- `git`/`gh` 显示为只读事实，不显示认证承诺。

### 18.2 Wizard 契约

- 固定 Runtime → Request → GitHub 三步。
- Computer 先于 Runtime。
- Runtime 先于 Skill Palette。
- Skill 只进入 `/` autocomplete。
- Name 和 Description 必填。
- Repository 可选。
- 无 Repository 时不可添加 Issue。
- 最后一页直接 Start，无 Review。

### 18.3 Context 契约

- Description 原样保存并作为核心。
- Name 不进入 Agent 指令。
- 多个 Skill Reference 都能解析。
- Opening Message 保留 `/skill` 文本。
- Agent-facing Context 才展开 Skill。
- Issue title/body/URL 进入上下文，comments 不进入。
- Workspace 和安装工具事实进入 Agent 环境上下文。

### 18.4 Conversation 契约

- 第一条可见消息是 Task Opening Message。
- 不显示 preparing/starting 等生命周期噪声。
- 启动错误显示在聊天之外。
- 第一版只有用户与一个 Agent Runtime。

### 18.5 Repository 契约

- 同一 Repository 不为每个 Task 重复完整 clone。
- 每个 Task 获得独立可写 Workspace。
- 依赖缓存按 Repository 和环境版本复用或失效。
- 一个 Workspace 同时只有一个写入 Run。

## 19. 测试策略

### 19.1 Computer-first Client

- Client mode 在没有 `--agent` 时可以注册。
- 注册不会创建 Agent session。
- 心跳更新 Connected 状态。
- 瞬时心跳错误不会结束后台进程。
- 重复注册更新同一个 Computer。
- Inventory 只检查支持的 Runtime 和 `git`/`gh`，不运行认证预检查。

### 19.2 Task Start 集成测试

使用现有 in-memory router/store 模式，提交与 Wizard 相同的 payload，并断言：

- Task 和 Run 已保存。
- Issue 快照已保存。
- 只发出一个幂等 Launch Command。
- Opening Message 已保存。
- 没有生命周期聊天消息。

必须覆盖：

- Repository-backed Task。
- Stand-alone Task。
- Issue 无 Repository 被拒绝。
- Issue 不属于 Repository 被拒绝。
- 其他用户 Computer 被拒绝。
- Offline Computer 不自动排队。
- 未验证 `gh` 登录仍允许启动。

### 19.3 Web Wizard 测试

使用 Testing Library 驱动完整三步流程，断言：

- Computer → Runtime → Skill 的依赖。
- 更换 Computer 清理无效 Runtime。
- 只读 `git`/`gh` 展示。
- Skill Palette 过滤和 `/` 插入。
- Name/Description 必填。
- Repository 可选。
- 无 Repository 时 Issue disabled。
- 动态多个 Issue。
- 第三步直接 Start。

### 19.4 Runtime Adapter conformance

对 Claude Code、Codex、OpenCode 和 Pi 使用共享 Task Start Context 测试，断言：

- 使用正确 Workspace。
- 收到同一核心 Description。
- 多个 Skill Reference 通过各自支持方式生效。
- Runtime 原生能力差异没有被平台伪装。

### 19.5 Repository Cache

- 第二个相同 Repository Task 复用 Cache。
- 每个 Task 仍获得独立 Workspace。
- 环境 setup version 变化使相应准备缓存失效。
- 并行 Task 不共享未提交修改。

### 19.6 GitHub

使用 fake GitHub client，不使用开发者真实账号：

- Repository search 和 URL lookup。
- Issue search。
- Issue/Repository 所属验证。
- title/body/URL 快照。
- comments 被省略。
- 后续 PR/Review/CI 状态映射。

本功能不引入新的 Browser E2E 框架；优先使用仓库已有 Vitest、Testing Library、router client 和 Adapter harness。

## 20. 交付分层

总目标必须按可独立验证的子系统交付，不能作为一个巨大实现任务一次开发。

### Slice 1：Computer-first Client

- Client mode。
- Computer 持久化。
- Inventory。
- Heartbeat。
- Computers 页面。

### Slice 2：Task、Run 与 Computer control

- Task/Run 模型。
- Computer-level Launch Command。
- 幂等启动。
- Run 生命周期。

### Slice 3：New Task Wizard 与 Stand-alone Task

- 三步 Wizard。
- Skill Palette 和 Description autocomplete。
- Stand-alone Workspace。
- Task Opening Message 和 Conversation。

### Slice 4：GitHub Context 与 Repository Workspace

- Server-side GitHub Connection。
- Repository/Issue 选择。
- Issue 快照。
- Repository Cache。
- 隔离 Workspace。

### Slice 5：Issue → Pull Request Delivery

- branch 和 Draft PR。
- PR/Review/CI 同步。
- 同一 Task 的修复循环。
- Merge/close reconciliation。

### Slice 6：文档与 Issue 驱动的 Agent handoff

- 结构化 dispatch 和 result artifact。
- 共享 Task coordination timeline。
- 独立 Run Workbench。
- 在明确产品需求后再引入多 Agent。

## 21. 明确不做的事情

Better Agent 不应：

- 把启动 Client 等同于启动 Agent。
- 要求每个 Task 都有 Project 或 Repository。
- 把 Skill checkbox 直接注入 Agent。
- 把 Task Name 当作 Prompt 重复发送。
- 把所有本机可执行文件展示给用户。
- 为普通启动主动测试 `gh` 登录。
- 因 `gh` 未认证而断开 Client 或禁止 Agent 连接。
- 重新设计 Runtime 的命令权限。
- 声称 Task Workspace 是安全边界。
- 把 Workspace/Agent 启动日志写成聊天。
- 在第一版创建 Agent-to-Agent Chat。
- 复制 GitHub Issue Tracker、Review 或 Merge Policy。
- 为多个 Task 复用同一个有未提交修改的工作目录。
- 因重连而重复启动同一个 Run。

## 22. 第一版完成标准

第一版被认为成立，需要完成以下用户闭环：

1. 用户在至少一台 Computer 安装并 Pair Better Agent Client。
2. Web 在没有运行 Agent 的情况下显示 Connected Computer。
3. 用户点击 New Task。
4. 用户选择 Computer 和该 Computer 上的 Agent Runtime。
5. 用户可以看到 `git`、`gh` 和 Skill Inventory。
6. 用户填写 Name 和 Description，并可通过 `/` 插入 Skill Reference。
7. 用户可以选择 Repository 和多个 Issue，也可以全部留空。
8. 用户点击 Start 后创建 Task 和 Run。
9. Client 准备正确类型的 Workspace 并启动 Runtime。
10. Conversation 第一条消息是组装后的 Task Opening Message。
11. 用户继续与 Agent 一对一交流。
12. 工具或启动失败时显示真实错误，而不是被预检查阻止。
13. 同一 Repository 的后续 Task 复用 Cache，但获得独立 Workspace。
14. Offline Computer 不会在未来重连时未经用户确认自动启动 Task。

完成这个闭环后，Better Agent 才从“远程连接单个 local agent session”变成真正的“个人本地 Agent 执行与协作平台”。

## 23. 相关文档

- `docs/specs/2026-07-15-new-task-wizard-and-agent-startup.md`
- `docs/research/2026-07-14-github-issue-to-pr-workflow.md`
- `docs/research/2026-07-15-multica-hive-agent-collaboration.md`
- `docs/adr/0015-platform-orchestrates-runtime-execution.md`
- `docs/adr/0016-first-release-is-personal-multi-agent.md`
- `docs/adr/0017-first-release-tasks-use-one-agent-conversation.md`
- `docs/adr/0018-github-integration-spans-server-and-computer.md`
- `docs/adr/0020-inject-environment-context-without-task-preflight.md`
- `docs/adr/0021-new-task-is-a-context-building-wizard.md`
- `docs/adr/0022-skills-are-injected-through-description-references.md`
- `docs/adr/0023-linked-issue-bodies-enter-start-context.md`
- `docs/adr/0024-first-message-is-the-assembled-task.md`
- `docs/adr/0025-task-name-and-description-have-separate-roles.md`
- `docs/adr/0026-repository-context-attaches-directly-to-task.md`

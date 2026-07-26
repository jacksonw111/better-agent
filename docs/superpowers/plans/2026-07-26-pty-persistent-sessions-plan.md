# 阶段 2.5 — PTY 持久 session + 项目内一键入口

日期：2026-07-26
背景：用户实测 PTY 可用,但 (1) 每次打开都新建 session(新 sessionId → 新 pty → 上次滚屏/claude 对话全丢,"消息不见了"),(2) 入口太绕(select session → start → 点 terminal 按钮)。
目标：session 持久、后台常驻(除非 End)、进项目直接列活跃 session、一键 reattach 或一键 New。

## 根因
- `pty.createSession` 每次铸新 sessionId,无持久记录;CLI 按 sessionId 存滚屏,但新 id = 新 pty = 空滚屏。
- viewer detach 时若 CLI 杀 pty,则后台不常驻。
- 入口叠在旧 task/session 选择流程上。

## 数据模型定案（DP）

### DP-S1. 持久 PTY session 记录（服务器唯一事实源）
- `pty_sessions` 表：id uuid、user_id、computer_id FK、project_id uuid 可空 FK projects、agent_kind、title(默认 `Session M/D HH:mm`)、status `"active" | "ended"`、created_at、last_activity_at。
- 生命周期：`createSession` → 建 active 行,返回**稳定 sessionId**。打开 `/terminal?session=<id>` → viewer OPEN 带该 id → CLI **首次 spawn / 已在跑则 reattach**(滚屏重放,P2-1 已有)。**detach 不改 status、不杀 pty。** `endSession` → status=ended + 通知 CLI 杀 pty。
- 稳定 sessionId 是核心修复:re-entry 用同一 id → reattach → 滚屏/claude 都在。

### DP-S2. CLI 持久化
- session manager:viewer 断开(detach)**不杀 pty**——pty 后台常驻。只在收到 End 指令(经 pty-ws 或控制通道)才 kill。
- 首个 OPEN(sessionId 未在跑)→ spawn;后续 OPEN(在跑)→ reattach + 重放滚屏。
- liveness:CLI 重启会丢 pty(children)。CLI 连上后上报"我还持有哪些 sessionId";服务器把不在其中的 active 行标 ended(避免僵尸"活跃")。最小实现即可。

## Slice

### P25-A：服务器 registry + CLI 持久化
- `pty_sessions` 表 + store + 迁移。
- `pty` router:`createSession`(建持久行,不立即 spawn)、`listSessions({computerId, projectId?})`(active 行,按 last_activity 倒序)、`endSession(sessionId)`(ended + 通知 CLI kill)、`renameSession`(可选)。
- CLI:detach 不杀 pty;End 指令 kill;OPEN spawn-or-reattach;重连上报持有的 sessionId + 服务器 reconcile ended。
- last_activity_at:pty 有输出/被 attach 时更新(轻量)。
- 测试:createSession 持久、同 id reattach 不新建、detach 后仍 active、endSession→ended+kill、listSessions 过滤、CLI 重启后僵尸标 ended。

### P25-B：项目内一键入口（web）
- Project 详情 / Computer+agent 视图:**活跃 session 列表**(`pty.listSessions`),每行:title + 状态 + 最近活跃,**整行点击 → `/terminal/$computerId?session=<id>` 直接 reattach 打开终端**(一步)。
- **New session** 按钮:`createSession` → 打开终端(一步)。
- 每 session 一个 **End** 操作(`endSession`)。
- **去掉旧的 select→start→terminal 三步绕路**:PTY 入口直接是"列表点开 / New",不经旧 task 选择器。
- 终端页:标题显示 session title;有"End session"入口。
- 测试:列表渲染、点击 reattach 导航带正确 session id、New session 流程、End。

## 收尾
- 全量验证 → CLI bump(持久化是行为变更)→ 发版 → 通知用户(说明:进项目 → 列表点开或 New,后台常驻,滚屏/对话保留,End 才停)。
- 说明限制:CLI 重启会丢后台 pty(children),重启后这些 session 标 ended——非 tmux 级独立守护,后续可做。

# Spike: detach 后可观测性 —— Claude Code hooks → 会话状态

**日期**: 2026-07-28
**真机**: claude 2.1.218 / codex 0.142.5(macOS)
**目标**: PTY detach 模式下,用户关掉网页后 agent 在后台跑。通过 Claude Code hooks 把
每个后台会话的粗状态(启动/工作中/turn 完成/结束)实时上报服务器,dashboard 跨机每
session 一行显示——**零终端解析、版本免疫**(spec §10、§13 阶段3)。

严格按下述**实测结论**实现,不要照抄推测。

---

## 核心红利:session_id 关联零成本

P25-C 已把 claude 会话 id 统一成我们的 pty session id(`claude --session-id <ourId>`)。
实测:**每个 hook 事件 stdin JSON 里的 `session_id` 就等于我们给的 `--session-id`**。

```
our --session-id = 11111111-2222-3333-4444-555555555555
SessionStart      sid=11111111-2222-3333-4444-555555555555
UserPromptSubmit  sid=11111111-2222-3333-4444-555555555555
PreToolUse        sid=11111111-2222-3333-4444-555555555555
PostToolUse       sid=11111111-2222-3333-4444-555555555555
Stop              sid=11111111-2222-3333-4444-555555555555
SessionEnd        sid=11111111-2222-3333-4444-555555555555
```

→ **不需要**任何文件映射 / 自定义环境变量 hack。hook 事件的 `session_id` 直接就是
`pty_sessions.id`,拿来更新该行状态即可。

## 事件序列(bypassPermissions 全自动,实测)

`SessionStart` → `UserPromptSubmit` → `PreToolUse` → `PostToolUse` → `Stop` → `SessionEnd`

exit 0 = **纯旁路**,claude 正常完成,hook 不干扰。

## 每事件真实字段(实测 keys,勿信推测的字段名)

| 事件 | 关键字段 |
|------|---------|
| `SessionStart` | `session_id`,`cwd`,`transcript_path`,`source`(`"startup"` 首启 / `"resume"` 恢复,实测确认) |
| `UserPromptSubmit` | `session_id`,`cwd`,`permission_mode`,`prompt`,`prompt_id`,`transcript_path` |
| `PreToolUse` | `session_id`,`cwd`,`permission_mode`,`tool_name`,`tool_input`,`tool_use_id`,`prompt_id`,`effort` |
| `PostToolUse` | 同上 + `tool_response`,`duration_ms` |
| `Stop` | `session_id`,`cwd`,`permission_mode`,`stop_hook_active`(bool),`last_assistant_message`,`background_tasks`,`session_crons`,`prompt_id`。**无 `stop_reason`**(那个字段名是推测,不存在) |
| `SessionEnd` | `session_id`,`cwd`,`transcript_path`,`reason`,`prompt_id` |

**修正上游推测**:不存在 `PermissionRequest` 事件、`notification_type` 字段、`Stop.stop_reason`。
只用上表实测字段。

## 状态机(第一版,确证事件驱动)

hook 事件 → 会话 `activity_state`:

| 触发 | activity_state |
|------|---------------|
| `SessionStart`(startup/resume) | `starting` |
| `UserPromptSubmit` / `PreToolUse` / `PostToolUse` | `working` |
| `Stop` | `idle`(一个 turn 完成,等下一个输入)——**核心"完成"信号** |
| `SessionEnd` | `ended`(可带 `reason`) |

三个终端外信号合成(spec §10):**进程存活/退出码**(CLI 100% 可靠,已有 CLOSE 帧)+
**字节活跃度**(已有 ACTIVITY 帧)+ **hooks 状态**(本 spike)。hooks 给的是最细粒度。

**Notification(等审批 / 等输入)**:需**交互**模式才触发,本 spike 未确证其字段
(default-perm 触发尝试因 macOS 无 `timeout` 命令 exit 127,与 claude 无关)。且平台默认
**bypassPermissions 全自动**,根本不会停下"等审批"。→ 第一版**不依赖 Notification**;
实现里可接收 `Notification` 事件并把原始 payload 透传,状态保守映射为 `idle`,子类型
(permission/idle)留待后续交互真机验证再细分。**不要**为未验证的 Notification 字段写死逻辑。

## Codex

**无 hooks 等价物**(实测确认 codex 0.142.5 无此机制)。第一版 codex 会话只有两个信号:
进程存活(CLOSE 帧)+ 字节活跃度(ACTIVITY 帧)→ 粗状态 `working`(有字节)/ `idle`(静默)/
`ended`。dashboard 对 codex 显示粗粒度即可,标注清楚。后续可选:wrap codex 输出做行级探测。

---

## 落地架构

hook 命令是 claude 触发的**独立短命子进程**,不在 CLI 主进程内,也没有 computer 密钥/
server 连接。因此:

1. **`agent-cli hook-emit <EventName>`** 子命令:读 stdin JSON → 连 CLI 主进程监听的
   **本地 unix domain socket**(按 computer 固定路径,如 `~/.better-agent/hook.sock`)→
   写一行 `{session_id, event, cwd, source?, reason?}` → **fire-and-forget**:连不上/写失败
   一律 `exit 0`(绝不干扰 claude)。不做网络、不做认证(本地 socket)。
2. **CLI 主进程**监听该 socket:收事件 → 状态映射(上表)→ 发 **STATE 帧(0x06,payload =
   UTF-8 状态串,已定义)**,`sessionId = event.session_id`。复用已有多路复用 WS + 认证。
3. **server relay-hub** 加 `onState(computerId, sessionId, state)` handler → pty-ws 落到
   `pty_sessions.activity_state` + `activity_state_at`。
4. **profile-sync** 往 `~/.claude/settings.json` 注入 hooks managed block(matcher `""`/`"*"`,
   command 指向 `agent-cli hook-emit <Event>`),走已有 `~/.claude` 写入机制。
5. **web** dashboard 跨机每 session 一行 `电脑·runtime·项目 | 状态 | 最近活跃`;session-list
   状态点。数据来自 `activity_state`。

## 切片(依赖:A → {B, C})

- **A**(db + server 状态链路):`pty_sessions` 加 `activity_state`/`activity_state_at`;
  store `setActivityState`;relay-hub `onState`;pty-ws 接 STATE 帧落库;pty router
  listSessions/query/getSession 返回该字段。迁移。
- **B**(CLI:hook-emit + 本地 socket 监听 + 状态映射 + STATE 帧 + settings 注入):最重、
  最不确定的一片。状态映射函数纯逻辑好测;socket + settings 注入需 fake/集成测。
- **C**(web:dashboard 跨机 session 状态行 + session-list 状态点)。依赖 A 的字段,与 B 并行。

## 验收

进程死/CLI 重启后,dashboard 不进终端也能看到每个后台 claude 会话:working(绿,动)/
idle(turn 完成,灰)/ ended。关掉页面 → 回 dashboard 一眼知道哪个 agent 跑完了、哪个还在干。

# Spike: 把 PTY 会话绑定到 claude / codex 的可 resume 会话 id

日期: 2026-07-27
分支: dev
性质: 技术验证(spike),真机实测,不改产品代码

实测环境: `claude` 2.1.218 (Claude Code) · `codex` codex-cli 0.142.5 · macOS (Darwin 25.3.0)。所有结论均来自下方贴出的命令与输出,不靠文档臆测。

---

## 摘要(先给结论)

| Agent | 能否用「我们的 id」创建会话? | 推荐绑定方式 | 首次 spawn | 进程死后 resume |
|---|---|---|---|---|
| **claude** | ✅ **能** —— `--session-id <uuid>` 直接用我给定的 UUID 创建 | **统一 id**:直接把 `pty_sessions.id` 当 claude session id | `claude --session-id <ourId>` | `claude --resume <ourId>` |
| **codex** | ❌ 不能指定,只能 **捕获** codex 自己生成的 id | **捕获 id**:存 codex 生成的 `session_id` 到 pty_sessions | `codex`(捕获启动时的 `session id:`) | `codex resume <capturedId>`(TUI)/ `codex exec resume <capturedId>` |
| pi | ✅ 能(`--session-id <id>` "creating it if missing") | 同 claude,统一 id | — | `pi --resume` / `--session <id>` |
| opencode | ⚠️ 只能续已存在会话(`--session <id>`),创建时不能指定 id | 捕获 id(同 codex 思路) | — | `opencode --session <id>` |

**一句话**:claude 可以「统一 id」(最干净,pty_sessions.id 直接就是 claude 的可 resume 会话 id);codex 只能「捕获 id」(spawn 后从启动输出/磁盘拿到 codex 的 session_id 回存)。两者 resume 命令行都稳定可用。

---

## 一、Claude Code(重点)

### 关键 flag(`claude --help` 摘录)

```
--session-id <uuid>   Use a specific session ID for the conversation (must be a valid UUID)
-r, --resume [value]  Resume a conversation by session ID, or open interactive picker
-c, --continue        Continue the most recent conversation in the current directory
--fork-session        When resuming, create a new session ID instead of reusing the original
```

`--session-id` 就是我们要的:**创建**一个用「我给定 UUID」的会话。

### 实测 1:`--session-id` 用我们的 id 创建会话(print 模式)

命令:
```bash
cd <scratch>/spike-cwd
MYID="11111111-2222-3333-4444-555555555555"
claude --session-id "$MYID" -p "Reply with exactly the word PONG and nothing else"
```
输出:
```
PONG
=== exit: 0 ===
```
落盘验证 `find ~/.claude/projects -name "*${MYID}*"`:
```
/Users/john/.claude/projects/-private-tmp-...-spike-cwd/11111111-2222-3333-4444-555555555555.jsonl
```
**结论**:transcript 文件名 = 我们给的 UUID(`<ourId>.jsonl`)。claude 直接采纳了我们的 id。

### 实测 2:`--session-id` 是「仅创建」,复用同 id 会报错

```bash
claude --session-id "11111111-2222-3333-4444-555555555555" -p "..."
# Error: Session ID 11111111-2222-3333-4444-555555555555 is already in use.
```
**结论**:`--session-id` 只能用于**首次创建**。第二次进入(resume)**必须**用 `--resume <id>`,不能再传 `--session-id`。因为我们的 `pty_sessions.id` 是新 mint 的 UUID,首次 spawn 永远是全新 id,这个约束天然满足。

### 实测 3:`--resume <id>` 恢复历史(接续对话)

```bash
claude --resume "11111111-2222-3333-4444-555555555555" -p "What was the secret codeword ...?"
# → "...the only prior message was a request to reply \"PONG\"..."
```
模型正确读到了上一轮的 PONG 历史(且那轮误传 BANANA 因 id 冲突未落盘,resume 也如实地只看到 PONG)。resume 追加写入**同一个** `<id>.jsonl`,不新建文件。

### 实测 4:交互 / PTY 模式(我们的真实场景)

我们不是 `-p` headless,而是在 PTY 里跑交互式 `claude`。用一个真实 PTY 驱动器(python `pty.fork`,120x40 窗口)实测。

**坑(务必记住)**:第一次跑交互 claude 时输出里出现:
```
⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker · restart with CLAUDE_CODE_FORCE_SESSION_PERS…
```
原因:本 spike 跑在 Claude Code 内部,子进程**继承了 `CLAUDE_CODE_CHILD_SESSION` / `CLAUDECODE` 等环境变量**,claude 检测到「我是另一个 claude 的子会话」→ **关闭 transcript 落盘**,于是 `<id>.jsonl` 根本不生成。
- Better Agent 的 PTY 父进程是我们自己的 CLI(不是 claude),正常不会有这些 marker;但**保险起见 spawn 时应显式清掉 `CLAUDE_CODE_*` / `CLAUDECODE` 环境变量**(见下方风险)。

清空这些 env 后重测(`env -u CLAUDE_CODE_CHILD_SESSION -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID ... claude --session-id <id>`):
- 交互 TUI 正常启动,无 "transcript saving is off" 警告;
- `find ~/.claude/projects -name "<id>.jsonl"` → **FOUND**,文件名就是我们的 id;
- 让它说 "MANGO",transcript 里如实记录 `user: say the word MANGO` / `assistant: MANGO`。

交互 resume(PTY 内 `claude --resume <id>`,非 `-p`):
- 问「上一条消息你说了哪个词」→ 回答 **MANGO**,历史接续成功;
- resume 仍写同一个 `<id>.jsonl`(未新建文件,`ls` 只有一个 jsonl)。

**结论**:`--session-id`(创建)、`--resume`(恢复)、磁盘 `<id>.jsonl` 落盘,在**交互 / PTY 模式下全部成立**,与 headless 一致。前提是不带 child-session env marker。

### cwd → 目录名 编码规则(实测)

`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`。实测编码:**把路径里的 `/` 和 `.` 都替换成 `-`**(有损)。
证据:`/Users/john/.better-agent/tasks/...` → 目录名 `-Users-john--better-agent-tasks-...`(`/.` 变成 `--`);我们的 scratch cwd `/private/tmp/.../scratchpad/spike-cwd` → `-private-tmp-...-scratchpad-spike-cwd`。
- 因为有损,**不要自己拼这个目录名**;要么直接用 `--session-id` 完全绕开落盘捕获(推荐),要么用 `--resume <id>`(claude 自己按 id 找文件,不需要我们知道目录名)。

---

## 二、Codex(`codex`)

### 会话机制

- Codex **没有** `--session-id` 这类「指定 id 创建」的 flag(`codex --help` / `codex exec --help` 均无)。session id 由 codex 自己生成(UUIDv7,如 `019fa2b0-f899-7493-bc33-e2855323cbd4`)。
- resume 子命令:
  - 交互:`codex resume [SESSION_ID] [PROMPT]`(`SESSION_ID` 可为 UUID 或 session name;`--last` 续最近一个)
  - 非交互:`codex exec resume <SESSION_ID> [PROMPT]`

### session 存哪 + id 怎么拿(实测)

**磁盘位置**:`~/.codex/sessions/YYYY/MM/DD/rollout-<ISO时间戳>-<sessionId>.jsonl`。文件名内嵌 session id。

实测启动 `codex exec`,startup banner **把 session id 直接打到 stdout**:
```
OpenAI Codex v0.142.5
--------
workdir: /private/tmp/.../cxcwd
model: gpt-5.6-sol
...
session id: 019fa2b0-f899-7493-bc33-e2855323cbd4
--------
```
对应文件:
```
~/.codex/sessions/2026/07/27/rollout-2026-07-27T01-28-54-019fa2b0-f899-7493-bc33-e2855323cbd4.jsonl
```
该文件**第一行**是 `session_meta`,含全部我们需要的字段:
```json
{"type":"session_meta","payload":{
  "session_id":"019fa2b0-...","id":"019fa2b0-...",
  "cwd":"/private/tmp/.../cxcwd","originator":"codex_exec",
  "source":"exec","cli_version":"0.142.5", ...}}
```
关键:**该文件在 session 启动时就写好了**(即便随后模型调用失败——我这里默认模型 `gpt-5.6-sol` 报 "requires a newer version of Codex",rollout 文件依然存在)。所以「监视目录拿 session_meta」对捕获是可靠的,不依赖模型是否成功。

> ⚠️ `~/.codex/session_index.jsonl` **不可靠**:实测该 exec 会话跑完后 `grep <id> session_index.jsonl` 计数为 0(索引没更新,最新条目还停在几天前)。**不要用 session_index.jsonl 做捕获**,用 sessions 目录里的 rollout 文件 / 或解析 stdout 的 `session id:` 行。

### resume 实测

```bash
codex exec resume 019fa2b0-f899-7493-bc33-e2855323cbd4 --skip-git-repo-check "say OK"
# → session id: 019fa2b0-f899-7493-bc33-e2855323cbd4   (同一个 id,续上了同一 rollout)

codex exec resume 00000000-0000-0000-0000-000000000000 --skip-git-repo-check "hi"
# → Error: thread/resume: thread/resume failed: no rollout found for thread id 00000000-...
```
**结论**:`codex resume <id>` 用**同一个 session id** 续接(id 稳定,不变);id 不存在时明确报 `no rollout found for thread id`(便于我们区分「会话已被清理」)。

### 交互 / TUI 模式注意点(实测踩坑)

- `--skip-git-repo-check` 是 **exec 专有** flag,交互根命令 `codex` 不接受(会打 usage 报错)。交互模式靠 trust 目录机制,不用这个 flag。
- 交互 TUI 首屏可能被**「Update available!」弹窗**(1. Update now / 2. Skip / 3. Skip until next version,"Press enter to continue")和 **trust 目录提示** 挡住,session(rollout)要等这些 modal 关掉、真正进入会话后才创建。本 spike 沙盒里被 update 弹窗卡住(不敢选 "Update now" 触发 curl 安装),故交互 TUI 的 rollout 未在此复现;但 exec 已证明 rollout+session_meta 在 session 启动即落盘,交互同构。
  - **产品侧应对**:PTY spawn codex 前,先处理/抑制 update 提示(codex 有配置项可关自动更新提示),并预置 trust。捕获仍走「spawn 后轮询 `~/.codex/sessions/今天/` 里 cwd 匹配、mtime 最新的 rollout,读 `session_meta.session_id`」。

---

## 三、其它 agent(简评)

- **pi**:`--session-id <id>` 文档写明 "Use exact project session ID, **creating it if missing**",即支持「统一 id」(同 claude);另有 `--resume`、`--session <path|id>`、`--fork`。可同法绑定。
- **opencode**:`-s, --session <id>` 是「continue by id」,`-c --continue`、`--fork`;**创建时不能指定 id**(只能续已存在的)。因此 opencode 走「捕获 id」模型(同 codex)。未深入实测其磁盘位置。

---

## 四、推荐实现方案

### 4.1 Claude —— 统一 id(首选)

`pty_sessions.id` 本身就是合法 UUID,直接当 claude session id 用,零额外存储、零捕获竞态。

- **首次 spawn**(pty_sessions 刚建、无历史):
  ```
  claude --session-id <pty_sessions.id>
  ```
- **reattach 到已死进程 → resume**(pty_sessions 已存在、进程不在了):
  ```
  claude --resume <pty_sessions.id>
  ```
- **判定用哪条命令**:看这个 session 之前**有没有真正启动过 claude**。最稳:新增一个标志位(下节),而不是靠「文件存不存在」(编码有损、易错)。
- **spawn 时务必**:`cwd` 固定为该 session 的工作目录(resume 要同 cwd 才找得到);清理环境变量 `CLAUDE_CODE_*`、`CLAUDECODE`(避免 child-session 关闭落盘)。

### 4.2 Codex —— 捕获 id

- **首次 spawn**:正常 `codex`(TUI)/ `codex exec`(headless)。spawn 后**捕获** codex 生成的 session_id:
  - 首选:解析 PTY 启动输出里的 `session id: <uuid>` 行(exec 一定有;TUI 需确认展示位置);
  - 兜底:轮询 `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`,取 `session_meta.cwd == 我们的cwd` 且 mtime 最新者,读其 `payload.session_id`。
  - 捕获到后**回存到 pty_sessions**(见下节 `agentSessionId`)。
- **reattach → resume**:
  ```
  codex resume <capturedSessionId>          # 交互 TUI
  codex exec resume <capturedSessionId>     # 非交互
  ```
- id 不存在时 codex 报 `no rollout found for thread id`,据此把该 pty_session 标记为「底层会话已失效」。

### 4.3 对 `pty_sessions` 模型的改动建议

现表(`packages/db/src/schema/pty.ts`)只有我们自己的 `id`,与底层 agent 会话无绑定。建议新增两列:

- `agentSessionId: text` — 底层 agent 的可 resume 会话 id。
  - claude / pi:等于 `pty_sessions.id`(统一 id,spawn 时即可写死);
  - codex / opencode:spawn 后捕获再回填(nullable,捕获前为空)。
- `agentSessionStarted: boolean`(或 `spawnCount` / `lastSpawnMode`)— 标记「底层会话是否已创建过」,用于在 reattach 时决定发 **create**(`--session-id`)还是 **resume**(`--resume` / `codex resume`),避免靠磁盘文件推断。

Spawn 决策伪码:
```
row = pty_sessions[id]
if agentKind in (claude, pi):
    cmd = row.agentSessionStarted
        ? [bin, "--resume", row.agentSessionId]
        : [bin, "--session-id", row.id]          // 首次;agentSessionId 预置 = row.id
else if agentKind in (codex, opencode):
    if !row.agentSessionStarted:
        spawn(bin ...); capture session_id; row.agentSessionId = captured
    else:
        cmd = [codex, "resume", row.agentSessionId]   // 或 exec resume
mark row.agentSessionStarted = true (spawn 成功后)
```

---

## 五、风险 / 注意

1. **交互模式 env 污染(claude)**:child-session marker 会静默关闭 transcript 落盘 → 会话无法 resume。**spawn claude 前必须清 `CLAUDE_CODE_*` / `CLAUDECODE` env**,否则「进程死了点进去恢复」直接失效且无报错。这是最容易踩、后果最隐蔽的坑。
2. **首屏 modal(codex)**:update 弹窗 / trust 目录提示会挡住会话启动 → rollout 不生成 → 捕获拿不到 id。需在 spawn 前抑制更新提示、预置 trust,并给捕获加超时+重试。
3. **cwd 编码有损(claude)**:`/` 和 `.` 都映射成 `-`,别自己反推目录名;用 `--session-id` / `--resume <id>` 让 CLI 自己按 id 定位,绕开路径拼接。
4. **`--session-id` 仅创建、复用即报错(claude)**:reattach 逻辑必须区分「首次 create」与「resume」,用状态位而非文件探测(见 4.3)。
5. **codex 捕获竞态 / 并发**:同 cwd 并发 spawn 两个 codex 时,「目录最新 rollout」可能张冠李戴。优先用 PTY 启动输出的 `session id:` 行(与具体进程一一对应);目录轮询兜底时要用 spawn 起始时间窗 + cwd 双重过滤,并尽量串行化同 cwd 的首次 spawn。`session_index.jsonl` 不可靠,勿用。
6. **版本稳定性**:`--session-id`(claude 2.1.218)、`codex resume`(codex 0.142.5)均为当前版本实测行为;flag 名/输出格式可能随版本变。捕获逻辑对 codex `session id:` 行做宽松正则,并保留「目录 session_meta」兜底,降低对单一格式的依赖。codex 本机默认模型 `gpt-5.6-sol` 报需要更新——与会话绑定机制无关,但说明该机器 codex 需要升级才能实际跑通模型对话。

---

## 附:实测所用 PTY 驱动器

`python3` `pty.fork` + `TIOCSWINSZ`(120x40),按脚本发送 `SEND:/ENTER/SLEEP:`,末尾 `SIGKILL` 子进程模拟「进程猝死」,再单独跑 resume 验证恢复。脚本为一次性验证工具,已随 scratchpad 清理。

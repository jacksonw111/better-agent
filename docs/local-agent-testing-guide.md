# Local Agent 测试指南（把本地 Claude Code 搬上线）

> 每个功能：**它是什么 → 怎么测 → 预期结果 → 坏了长什么样**。
> 90% 的"功能不工作"都是**本地 CLI 没更新到最新版**——先做第 0 步。

---

## 0. 前置准备（每次测试前必做）

```bash
# 1) 拉最新代码 + 依赖
cd ~/better-agent && git pull && pnpm install

# 2) 重新构建本地 CLI（关键！旧 CLI 没有新事件/新控制）
pnpm -F bridge-cli build     # 或直接用 pnpm -F bridge-cli dev 跑源码

# 3) 更新网页/服务端镜像（Workers 由 CI 自动部署，compose 侧手动拉）
cd deploy/compose && docker compose pull && docker compose up -d
```

**判断 CLI 是否够新**：`agent-cli --help`（0.2.0 前叫 `better-agent-bridge`，旧名仍可用）应能看到 `--agent`、`--resume`、`--server`、`--token`。缺任何一个 = 版本旧，重新 build。

---

## 1. 创建 Agent + 拿 Token

**是什么**：一个 Local Agent = 一个绑定了「agent 类型」的 token。token 常驻、可复制、与 agent 一对一。

**怎么测**：
1. 网页进 **Local Agents** → **New / 添加**。
2. 弹窗里**必须先选 agent 类型**（claude-code / pi / opencode / codex）——不选无法提交。
3. 提交后进入该 agent 的详情页。

**预期**：
- 不选类型时「创建」按钮禁用。
- 创建后详情页有 **Connection 面板**，直接显示 **token（可复制）** 和一条**开箱即用的 CLI 命令**（命令里的 `--agent` 就是你选的类型）。
- **刷新页面、重新进入，token 依然在**（不再是一次性）。

**坏了长什么样**：token 只显示一次 / 找不到 token / 有单独的 Tokens 页面 → 说明镜像是旧的（重做第 0 步第 3 条）。

> 旧的 token（重构前创建的）会显示「重新创建以获得可复制 token」提示——这是正常的，删掉重建即可。

---

## 2. 删除 Agent

**是什么**：token 不能单独删；删除 agent = 删除它的 token + 所有会话 + 聊天记录。

**怎么测**：详情页点删除 → 确认。

**预期**：该 agent 从列表消失；它的 token 立即失效（用它启动 CLI 会被拒）。没有「只删 token 保留 agent」这种操作。

---

## 3. 启动本地 CLI（连上网页）

**怎么测**：
1. 从 agent 详情页**复制那条 CLI 命令**。
2. 在你要让 agent 干活的项目目录里跑它（把 `--dir .` 改成目标目录，或就在该目录执行）：
   ```bash
   agent-cli --agent claude-code --dir . --token bt_xxx --server https://agent-api.trendf.top
   ```

**预期**：CLI 打印已连接；网页该 agent 详情页头部状态变 **Live**。

**坏了长什么样**：
- CLI 报 token 无效 → token 复制错了 / agent 被删了。
- 一直 Connecting → `--server` 不对，或网络问题。

---

## 4. 聊天 + **输入持久化**（本次核心修复）

**是什么**：你发的消息现在会被持久化（之前只有 agent 的回复被存）。

**怎么测**：
1. 在网页输入框发一句「你好，介绍下这个项目」。
2. 等 agent 回复完。
3. **刷新页面**（或换个浏览器/设备重新进入这个 session）。

**预期**：
- 发送瞬间**立刻**看到你自己那条消息（乐观回显）。
- 刷新后**你的消息和 agent 的回复都在**，顺序正确，**不重复**。

**坏了长什么样**：刷新后只剩 agent 的回复、你的消息没了 → 本地 CLI 是旧版（这个修复在 CLI 侧，务必重 build）。

---

## 5. Thinking 加载指示器

**是什么**：发送后到 agent 吐出第一个字之间（claude 常有 2–5 秒），显示转圈的「Thinking…」。

**怎么测**：发一句需要思考的话，盯着发送后的那几秒。

**预期**：出现转圈 + 「Thinking…」；agent 一开始出字/出思考，指示器立即消失。

---

## 6. Reasoning（思考过程）

**是什么**：agent 的思考内容折叠在一个「Thinking」块里。

**怎么测**：让 claude 做需要推理的任务（如「一步步算 17×23」）。

**预期**：回复上方有可展开的思考块，内容不为空、**不重复渲染**（本轮修过重复 bug）。

**坏了长什么样**：思考显示两遍 / 有个空气泡 → 旧版 CLI。

---

## 7. 状态栏 + Usage 面板

**怎么测**：连上后看详情页头部；发几轮对话后看用量。

**预期**：
- 头部一行：`Session: <id>`（不是 untitled）、**单一**连接状态、model / 权限 / 工具数 / MCP 徽标。
- **只有一个状态指示器**（不再出现「idle 和 live 打架」）。
- 用量面板：cost / input / output / cache / turns / 时长（claude、opencode 有；pi 是轮询用量，可能不显示流式用量条）。

---

## 8. Session 对上 + Past conversations（历史会话）

**是什么**：网页 session 对应 claude 的本地 session；可列出该目录下过去的 claude 会话。

**怎么测**：
1. 头部有 **Past conversations** 按钮（仅 claude/opencode 显示，pi 不显示——见第 11 条能力门控）。
2. 点开。

**预期**：列出该 `--dir` 目录下过去的 claude 会话（标题 + 分支 + 时间），每条给一条 `--resume` 命令可复制。头部 `Session:` 显示的是 claude 的真实 session id。

**坏了长什么样**：
- 一直「Loading…」或「No past conversations」→ (a) 你启动 CLI 的 `--dir` 目录下确实没有 claude 历史会话；(b) 本地 CLI 旧版没有 listSessions 控制。
- **自测命令**（确认 SDK 层是否有数据）：在你的项目目录下，claude 有历史会话时应能列出。若这里有、网页没有 → CLI 版本问题。
- 目前是「复制 `--resume` 命令」手动续接，网页一键 resume 暂未做。

---

## 9. Slash / Skills

**是什么**：两处——① 输入框打 `/` 弹选择器；② 头部 **Skills & commands** 弹窗直接列出所有名字。

**怎么测**：
1. 输入框输入 `/` → 应弹出命令 + skill 列表，键盘可选。
2. 头部点 **Skills & commands** → 弹窗列出该 agent 报告的所有斜杠命令名 + skill 名。

**预期**：claude 有完整列表；**pi/opencode 现在也会回传**（本轮修的），所以它们也能看到。

**坏了长什么样**：pi/opencode 下列表为空 → 本地 CLI 旧版（回传 skills 是 CLI 侧改动）。pi 的命令形状按其文档实现、**未在真机验证**——若名字对不上，把 CLI 输出发我。

---

## 10. 控制：Interrupt / 切模型 / 切权限

**怎么测**（仅 claude 完整支持）：
- 发一个长任务，点 **Interrupt** → 当前轮停止，但 session 还活着，可继续聊。
- 用 model 选择器切 default/opus/sonnet/haiku。
- 用权限下拉切 default/acceptEdits/plan/…。

**预期**：三者都对当前 claude session 生效。

**坏了长什么样**：pi 会显示这些按钮但点了没反应——pi 适配器的控制接线还没做（能力表声称支持、实际未接，属已知）。

---

## 11. 各 agent 差异（能力门控）

**是什么**：网页按每个 agent 的能力表**只显示它支持的功能**。

**怎么测**：分别用 `--agent pi`、`--agent opencode` 起 CLI，对比 claude。

**预期**：
- **pi**：无 Past conversations；无原生工具审批；用量是轮询（可能无流式用量条）；权限只有 default/plan。
- **opencode**：有 Past conversations、审批；权限 default/plan。回复应是**一句一个气泡流畅累积**（本轮修了「一个词一个气泡」）。
- **codex**：保守——只开 reasoning/interrupt，其余隐藏（等真机验证再放开）。

**坏了长什么样**：opencode 一个词一个气泡 / pi 消息渲染两遍 → 本地 CLI 旧版（都在 CLI 侧修的）。

---

## 12. X MCP 工具（9 → 8 个）

**是什么**：X/Twitter 工具，通过 MCP 给任意 agent 用。

**怎么测**：
1. 从浏览器 x.com 的 cookie 取 `auth_token`。
2. MCP 配置里 `Authorization: Bearer <你的auth_token>`（bearer 就是 X 的 auth_token，二者同一个）。
3. 逐个调工具。

**预期**：
- `x_search_tweets` / `x_search_users` / `x_user_tweets` / `x_user_media` → 正常。
- `x_user_replies` → 现在返回**用户自己的回复**（不再是被回复的原推）。
- `x_tweet_thread` → 现在**能返回内容**（修了路径 bug）。
- `x_followers` / `x_following` → 应返回粉丝/关注；**若仍空**，用下面命令抓一次原始结构发我：
  ```bash
  curl -s 'https://better-agent-mcp.jacksonwen001.workers.dev' \
    -H 'Authorization: Bearer 你的auth_token' -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x_followers","arguments":{"screen_name":"某公开账号","limit":3}}}' | head -c 600
  ```
- `x_user_likes` → **已删除**（X 2024 起点赞私密，永远空）。

---

## 排查速查表

| 现象 | 最可能原因 |
|---|---|
| 刷新后没有我的消息 / 一个词一个气泡 / pi 渲染两遍 / skills 列表空 / past conversations 空 | **本地 CLI 旧版**（重 build） |
| token 一次性 / 有单独 token 页 | **web/server 镜像旧**（compose pull） |
| CLI 连不上 / token 无效 | 命令从详情页重新复制；agent 没被删 |
| followers/following 空 | 抓原始结构发我（见第 12 条） |
| pi 控制按钮没反应 | 已知：pi 控制接线未做 |

---

*本轮改动对应提交：`560cd86`(输入持久化) `c902eca`(删 likes) `dd799e9`(X 工具) `2f508df`(token 重构) `c72f48b`(Thinking+skills 列表) `3e9017e`(pi/opencode 回传 skills)。*

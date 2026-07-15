# 竞品调研：mco / Hive / Multica（2026-07-13，会话记录落盘）

> 原始调研发生在 2026-07-13 的会话中（针对 `agent-cli` / local-agent workspace 计划），此文档为结论落盘。
> 对照对象：我们的 workspace 计划（[`local-agent-workspace-plan.md`](../local-agent-workspace-plan.md)，P0–P5）。

## 一、三个项目定位

### mco（mco-org/mco，449★，维护期）
- CLI-first 多 agent 并行编排：同一任务发给多个 coding agent CLI，保留各自完整回答，不做自动共识。Python，11+ provider 薄适配（拼一条 `claude -p …` one-shot 命令收 stdout）。
- **值得借鉴**：① 版本化机器可读合约 + 每家 CLI 真实报文 probe fixtures（防适配器被上游升级打破）；② complete/partial/failed 聚合状态机（单 provider 挂了不丢其他结果）；③ ACP 作为通用兜底通道（支持 ACP 的新 CLI 免写专用适配器）；④ 本地 raw transcript 落盘便于排查归一化 bug。
- 作者已转向 Hive；不建议依赖，定位为设计参考。

### tt-a1i/hive（hivehq.dev，415★，半停滞）— mco 作者的后继，真竞品
- "Browser-native hive-mind for CLI coding agents"：本机 daemon（127.0.0.1）+ 浏览器，agent 以真实 PTY 进程跑（9 家预置）。
- **team protocol**：往 agent PATH 注入 `team` 命令（`team send <worker> "<task>"` / `team report`），任务图落仓库 `.hive/tasks.md`；auto-staff 按任务临时招 coder/tester/reviewer；400+ 角色模板 marketplace。
- **权限全 bypass**（`--dangerously-skip-permissions`/`--yolo`），无沙箱无多用户；远程访问靠 E2E 加密隧道 opt-in，桌面端是信任根。

### Multica（multica-ai/multica，40k★，高活跃）— 体量最大的同赛道玩家
- "managed agents platform"：issue/看板驱动（enqueue→claim→start→complete/fail），Go + Next.js + Postgres，Electron/移动端，官方云或自托管（修改版 Apache 2.0）。
- 本地 daemon 自动探测 PATH 上 13+ 家 agent CLI，**3s 轮询领任务** + 心跳；每任务隔离 workspace、headless 起 agent（`--yolo`/acp）。Squad 多 agent 编组、Autopilot（cron/webhook 自动建 issue 派活）、skills 库、30 个服务端 agent 模板。
- **弱点**：fire-and-forget headless，无持久交互式会话，审批被 yolo 绕掉，轮询非双工，无文件树/git/终端工作台。

## 二、赛道判断

两派分化：**任务派**（hive/Multica：headless 跑任务 + 多 agent 编排）vs 我们的**会话派**（深度交互式会话 + 审批门控）。Multica 40k★ 证明"agent 当队友"需求巨大，但两家都牺牲了交互深度与安全。我们的差异化空档明确：

> **能远程、能审批、能看清 agent 每一步** —— 对外定位的核心表述。

支撑点（截至 2026-07-15 均已落地）：WS 双工（vs Multica 3s 轮询）、gated 审批 + 跨设备审批重投（vs 全员 yolo）、事件级工具卡/回合脊线（vs 进度条）、文件树/git/shell 工作台（vs 无）、多 provider 会话索引 + 跨会话搜索、图片/推送/语音。

## 三、对计划的启示（当时的建议 → 现状）

1. **P0–P5 方向不用改** → 已按原计划全部执行完。
2. **Phase 6（多 agent lane）参考**：tt-a1i/hive 的 team protocol（PATH 注入、任务图落 `.hive/tasks.md` 随仓库走、可审计）实现成本低，是多 agent lane 的好底子；Multica 的 per-task 隔离 workspace + headless 薄适配可补广度。
3. **Autopilot 是被验证的需求**：Multica 的 cron/webhook 自动派活与我们云端已有 schedule 能力天然衔接 —— server 定时向 bridge 下发 text 命令即可，无需整套 issue 系统。候选 backlog 项。
4. **远程安全叙事**：hive 主打"数据不出本机、E2E、桌面为信任根"；我们是 server 中继、事件落云端库 —— 对隐私敏感用户是劣势、对多设备/团队是优势，文档营销要主动讲清；长期可评估 E2E 通道作为企业选项。
5. **竞品监控名单**：Multica（最活跃）> tt-a1i/hive（半停滞）> aden-hive（不同赛道，YC 的 LiteLLM agent DAG 框架，忽略）。Multica 支持的国内 CLI（kimi/kiro/qoder/trae/codebuddy）提示生态扩张——我们的会话索引/适配器留了扩展位。

Sources: github.com/mco-org/mco · github.com/tt-a1i/hive (hivehq.dev) · github.com/multica-ai/multica · github.com/aden-hive/hive

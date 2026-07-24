# 阶段 2 实施 plan — PTY 终端核心重构

日期：2026-07-23
依据：`docs/specs/2026-07-23-pty-terminal-architecture.md`（§4 性能、§5 传输、§6 CLI、§7 server、§12+附录A 删除面）；spike `docs/research/2026-07-23-node-pty-bun-spike.md`（pty-broker 方案已验证）。
原则：**风险优先、先建新再删旧、每片验证。** 先把 pty-broker + 传输 + xterm 端到端跑通并过性能闸，**再**删旧 local agent 整套（附录 A）。全部完成 + 旧代码清理干净 + 验证发版后一次性通知用户。

## 设计定案（DP，各 slice 不得另发明）

### DP-PTY1. pty-broker（原生 C，内嵌单二进制）
- 小 C 程序用 `forkpty` 持有 pty，作为 CLI 的子进程。fd 约定：
  - fd0(stdin)=pty 输入(击键)；fd1(stdout)=pty 输出(原始字节)；fd3(控制入)=resize `{rows:u16,cols:u16}`；fd4(控制出)=退出码/事件。
  - argv：pty 内要跑的命令(如 `claude ...`) + 初始 winsize。
  - 子进程退出 → broker 经 fd4 发退出码后退出。
- 交叉编译 4 target(darwin/linux × arm64/x64)的无依赖二进制,内嵌进 CLI bundle(base64/bytes);运行时解到临时路径 + `chmodSync(0o755)` + spawn(spike 已验证 Bun.write+chmod 可行)。CI 加一步交叉编译+内嵌。

### DP-PTY2. 帧协议（CLI↔server↔web，二进制，一台电脑一条 WS）
- 帧：`[type:u8][sessionId:16B UUID][payload...]`。
- type：`0x01 DATA`(pty 字节,双向)、`0x02 RESIZE`(rows:u16,cols:u16,web→CLI)、`0x03 OPEN`(session 开始/attach)、`0x04 CLOSE`(结束+退出码)、`0x05 ACK`(流控:累计已消费字节 u32/u64,web→CLI)、`0x06 STATE`(粗状态,CLI→web,阶段3用)。
- **服务器纯中继**:读帧、按 sessionId 路由到另一侧(web viewer ↔ CLI),**不解析 DATA、不落库**。复用 ws-session 连接状态机 + Computer 签名认证。

### DP-PTY3. 滚屏 + reattach
- CLI 守护每 session 有界 ring(如 256KB / N 行)存最近 pty 输出。web attach(收到 web 的 OPEN)→ CLI 把滚屏作为一次 bulk DATA 突发发出,再转 live。**服务器不存滚屏**(留 CLI 本地)。

### DP-PTY4. 流控（防 OOM/慢的核心）
- web 从 xterm write 回调累计已消费字节 → ACK 帧。CLI 记 in-flight=sent-acked;>`HIGH_WATER`(1MB) 暂停读 broker stdout(→ pty 反压子进程);<`LOW_WATER`(256KB) 恢复。命名常量。

### DP-PTY5. 帧合并
- CLI 把 broker stdout 按 ~8–16ms 窗口合并再发 DATA(一窗一帧上限),避免刷屏 TUI 逐字节帧。

### DP-PTY6. web xterm（性能对标 native）
- `@xterm/xterm` + `@xterm/addon-webgl` + `@xterm/addon-fit`。数据路径:WS 二进制帧 → `term.write(Uint8Array)`,**React 从不因数据重渲染**。resize:fit → RESIZE 帧。有界滚屏(10k 行)。流控:`term.write(data, () => { acked+=len; maybeSendAck() })`。

## Slice 分解（严格串行，每片验证后进下一片）

### P2-0：pty-broker + CLI PTY spawn（风险优先,先做）
- 按 DP-PTY1 写生产版 pty-broker(C),交叉编译脚本 + 内嵌 + 运行时解包。CLI 新模块 `pty/`:spawn broker、读写 pty 字节、resize、退出码、干净 kill。
- **验证(硬门槛)**:本地在 pty 里跑真实 `claude`,拿到字节流、resize 生效、退出码正确、kill 无孤儿。CI 交叉编译 4 target 通过。**不过不进下一片。**

### P2-1：多路复用字节传输（CLI↔server↔web）
- 按 DP-PTY2 帧协议。CLI:一条 WS/computer,session 的 DATA/RESIZE/OPEN/CLOSE/ACK 多路复用;滚屏 ring + reattach 重放(DP-PTY3);流控(DP-PTY4);帧合并(DP-PTY5)。改造复用 ws-duplex/ws-session/relay-store 的重连+窗口机制,payload 换字节。
- server:纯字节中继,按 sessionId 路由,签名认证,**不落库**。
- 验证:CLI↔server↔(测试 client) 端到端字节往返、reattach 重放、断线重连续传、流控暂停/恢复。

### P2-2：web xterm 终端（性能闸）
- 按 DP-PTY6。xterm+WebGL,热路径零 React,二进制帧→write,流控 ACK,resize,有界滚屏,reattach 一次性 bulk write。把 workspace 里的假终端 tab 换成真 xterm。
- **性能验收(spec §4.7,硬门槛)**:cat 大文件流畅且内存不涨、stream ≥100MB 不崩、击键延迟≈native+RTT、多 session 只可见者全速、重绘密集不卡。**不过回炉。**

### P2-3：删除旧 local agent 整套（清理干净）
- 按附录 A 删除:CLI normalize/、adapters/ 事件层、事件中继/命令;web bridge/ 工具卡/turn/fold/假终端/send-outbox;server bridge 结构化 ingest/persist/stream;DB bridge_messages。
- **grep 到零孤儿引用**,build/type/test 全绿证明删干净;保留面(computer 身份、project clone/query、skills/mcp/memory、CUA、cloud chat)不误伤。

### P2-4：run 状态改由进程存活定义 + 收尾接线
- 附录 A.4:runs/tasks 保留为启动+workspace 记录,删事件派生的 status/reconcile,run 状态改由 PTY 进程存活(exit/无输出超时)定义;重启/watchdog 触发器改为进程退出。
- workspace 文件/Git/Shell 侧栏:本阶段**先门控隐藏**(依赖被删通道),标记为后续用瘦 RPC 重接(不阻塞 PTY 主线)。

## 收尾
- 全片验证(隔离 worktree 全量) → CLI bump(pty-broker + 传输是重大变更) → 发版 → 一次性通知用户(阶段 2 完成 + 性能验收数据 + 旧代码清理确认)。

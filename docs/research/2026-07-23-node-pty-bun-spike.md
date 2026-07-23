# node-pty 在 `bun build --compile` 下的技术验证（PTY 阶段 2 门控风险）

- 日期：2026-07-23
- 作者：spike 子代理（技术验证）
- 环境：macOS 26.3.1 arm64（Apple Silicon VM）、Bun **1.3.14**、Node v24.14.0、`cc`(Apple clang)
- CLI 目标平台（`.github/workflows/release-cli.yml`）：`bun-darwin-arm64`、`bun-darwin-x64`、`bun-linux-x64`、`bun-linux-arm64`
- 现状：`apps/bridge-cli` 用 `bun build --compile` 打成**单个自包含二进制**（内嵌 Bun 运行时，用户机器无需 Node/npm）分发。

---

## 摘要（一句话结论）

**node-pty 在 Bun 下不可用**——不是"打包不进单二进制"这一个问题，而是**双重死亡**：(1) 即使用 `bun run`，node-pty 的数据流也完全不通（读到 0 字节、退出码错误）；(2) 它的 `.node` 原生绑定用动态路径 `require`，`bun build --compile` 根本探测/内嵌不了。

**但 PTY 目标本身在 Bun 单二进制下完全可行。** 推荐方案：**内嵌一个约 50KB 的原生 C "pty-broker" 可执行文件**——它用 `forkpty` 自己持有 pty、把数据通过**普通管道**中继给 Bun 端、用一个控制 fd 接收 resize 命令。实测：编译成单二进制、从无 `node_modules` 的隔离目录运行，**双向数据、resize、SIGWINCH、子进程退出码、干净清理全部工作，且完全不用 `bun:ffi`**。对"单二进制"卖点**零影响**（体积几乎不变，仍是一个二进制），代价只是 CI 增加一步「为 4 个目标交叉编译这个 C 小程序」。

方案排序（详见文末）：

1. **内嵌原生 pty-broker（管道中继）** ← 推荐，已完整验证
2. 纯 `bun:ffi` openpty + 内嵌 setsid/TIOCSCTTY 小 helper（数据/退出码 OK，但 **resize 走不通**，见下）
3. node-pty / forkpty-via-FFI ← **均不可用**
4. 退回「Node + npm 安装」分发 ← 放弃单二进制，代价最大，非必要

---

## 1. node-pty 在 `bun build --compile` 下能否工作？——不能（两层都挂）

### 1.1 安装：原生绑定有预编译产物，但 Bun 跳过了 postinstall

```
$ bun add node-pty
installed node-pty@1.1.0
$ find node_modules/node-pty/prebuilds -name '*.node'
node_modules/node-pty/prebuilds/darwin-arm64/pty.node   # 本机架构预编译存在
$ ls -l node_modules/node-pty/prebuilds/darwin-arm64/
-rw-r--r--  pty.node
-rw-r--r--  spawn-helper        # 注意：无执行位
```

node-pty 在 macOS 上需要一个 `spawn-helper` 可执行文件（做 setsid/TIOCSCTTY），正常由 `postinstall` 脚本 `chmod +x`。**Bun 默认不运行生命周期脚本**，所以 helper 没有执行位。第一次 `bun run` 直接：

```
error: posix_spawnp failed.   # spawn-helper 没有 +x
```

手动 `chmod +x spawn-helper` 后，spawn 能过了——但真正的问题在数据流。

### 1.2 运行时数据流：Node 正常，Bun 读不到任何数据（致命）

同一个最小程序（spawn `bash -c "echo HELLO; sleep; exit 7"`，`onData` 收集、`onExit` 打印）：

```
########## NODE ##########
CAPTURED=["HELLO_FROM_PTY\r\n"]
EXIT code=7 signal=0
########## BUN ##########
CAPTURED=[""]                 # ← 零字节
EXIT code=0 signal=1          # ← 退出码错误(应为7)，收到 SIGHUP
```

根因：node-pty 用 `this._socket = new tty.ReadStream(term.fd)`（`lib/unixTerminal.js:93`）从 pty master fd 读数据。**Bun 的 `tty.ReadStream` 无法从一个 pty master fd 读出数据**，于是 `onData` 永不触发、退出码也拿错。原生 `.node` 绑定本身在 Bun 里能 `dlopen` 加载（`pty.fork` 被调用了），但围绕它的 Node fd 流机制在 Bun 下不通。**这一条就已经判 node-pty 死刑，与打包无关。**

### 1.3 编译进单二进制：`.node` 根本进不去

```
$ bun build --compile --target=bun-darwin-arm64 test-echo.mjs --outfile echo-bin
$ ./echo-bin   # 从任意目录运行
error: Failed to load native module: pty.node, checked: build/Release, build/Debug,
prebuilds/darwin-arm64: Cannot find module './prebuilds/darwin-arm64//pty.node'
from '/$bunfs/root/echo-bin'
```

node-pty 的加载器（`lib/utils.js`）用**运行时拼接的动态路径** `__require(dir + "/" + name + ".node")` 去加载 `.node`。`bun build` 的打包器无法静态识别这种动态 require，因此 `.node` 不会被内嵌；编译后的二进制在 `/$bunfs/root/` 虚拟文件系统里找不到 `prebuilds/darwin-arm64/pty.node`。即便数据流没问题，**单二进制也加载不了 node-pty 的原生模块**。

> 结论：node-pty 在 Bun 下**运行时数据流不通 + 无法内嵌**，两个独立的硬阻断。放弃。

---

## 2. 备选方案逐个实测

### 2.0 Bun 是否自带 pty？——没有

`Bun.spawn` 存在，但 `stdio` 选项只有 `inherit / pipe / ignore / 数字fd / Blob`，**没有 pty 选项**，也没有 `Bun.PTY` 之类 API（Bun 1.3.14 实测）。所以必须自己造 pty。

### 2.1 `bun:ffi` 直接调 `openpty`（数据/退出码 ✅，resize ❌）

用 `bun:ffi` 的 `dlopen` 打开系统库（macOS：`libSystem.B.dylib`；Linux：`libutil.so.1`），绑定 `openpty/ioctl/read/close/fcntl`，再用 `Bun.spawn` 把 slave fd 作为子进程 stdio。**数据平面工作良好**：

```
[openpty] rc=0 master=5 slave=6
[child] IS_A_TTY            # 子进程确实拿到真 tty (test -t 0 通过)
[child] SIZE=24 80         # 初始窗口大小正确
[exit] code=7 signal=null  # 退出码正确
```

而且**编译成单二进制、从隔离目录运行，一切照常**（`dlopen` 的是系统库，任何机器都在）：

```
$ bun build --compile --target=bun-darwin-arm64 ffi-pty3.ts --outfile ffi-bin  # 61MB
$ cd /tmp/ffi-iso && ./ffi-bin      # 无 node_modules、无源码
[openpty] rc=0 ... [exit] code=7   # 通过
```

**但 resize 走不通。** 用 `bun:ffi` 调 `ioctl(master, TIOCSWINSZ, &winsize)` 设置窗口大小，返回值 `rc=0` 看似成功，子进程读回的却是**垃圾值**：

```
pre-spawn master ioctl 40x120 rc=0
child: SZ=25760 28529      # ← 期望 40 120，实为垃圾
```

**根因（重要）**：`ioctl` 是**变参函数** `int ioctl(int, unsigned long, ...)`。`bun:ffi` **不支持变参 ABI**。在 arm64 上，变参实参走栈传递，而 `bun:ffi` 按固定 3 参签名把指针放进寄存器 `x2`——ABI 不匹配，`ioctl` 从错误的内存位置读 winsize，于是写入垃圾/无效果（还会在连续多次 ioctl 时把 Bun 打崩：`panic: Segmentation fault`）。**这是纯 FFI 路线做 resize 的硬伤（至少 macOS arm64）。**

> 交叉验证：node-pty 在 **Node** 下同一台机器 resize 正常（`24 80 → 40 120`），证明操作系统层面 master 侧 `TIOCSWINSZ` 传播是支持的——问题**纯粹**出在 `bun:ffi` 无法正确调用变参 `ioctl`，不是 OS 限制。

### 2.2 `bun:ffi` 调 `forkpty`——直接崩溃（Bun fork 不安全）

`forkpty` 会 fork 出子进程并在**子进程里返回到 JS**，随后我们要在 JS 里构造 argv 再 `execvp`。Bun 运行时（JSC + 多线程）**fork 后不安全**，子进程一执行 JS 就段错误：

```
[parent] forkpty pid=16594 master=4
panic(main thread): Segmentation fault at address 0x301002968
oh no: Bun has crashed.
```

> `forkpty`（以及任何"fork 后在 Bun 里跑代码"的方案）**不可用**。必须用 `Bun.spawn`（其 fork+exec 全在原生代码里完成，安全）。

### 2.3 外部系统工具（`script`/`setsid`）——可移植性差，不推荐

`setsid(1)` 只有 Linux（util-linux）有、macOS 没有；`script`/`unbuffer` 各平台参数不一致且不可靠。作末选，不展开。

### 2.4 ✅ 推荐：内嵌原生 C "pty-broker"（管道中继）——完整验证通过

思路：把"node-pty 的原生核心"改写成一个**独立的小可执行文件**（不是 `.node` 插件，因为插件内嵌不了；而普通可执行文件可以被 Bun 作为文件资产内嵌、运行时自解压）。这个 broker 用 `forkpty` 自己持有 pty，然后：

- **数据平面走普通管道**：broker 的 fd0 = 主机→子进程数据，fd1 = 子进程→主机数据。Bun 端只用普通 `Bun.spawn` 的 `stdin/stdout` 管道读写——**完全不碰 `bun:ffi`**，绕开 2.1 的数据流 bug 和 2.2 的 fork bug。
- **resize 走控制 fd**：broker 监听 fd3，收到 `R<rows> <cols>\n` 就在**原生代码里**调 `ioctl(master, TIOCSWINSZ, ...)`——绕开 `bun:ffi` 变参 `ioctl` 硬伤。
- broker 用 `poll()` 同时照看 {fd0, master, fd3}；子进程退出后 `waitpid` 取退出码，broker 以**相同退出码**退出。

Broker 关键代码（`pty-broker.c`，约 90 行，编译产物 50KB）：

```c
#if defined(__APPLE__)
#include <util.h>      // macOS: forkpty/login_tty 在 libSystem
#else
#include <pty.h>       // Linux: forkpty 在 libutil，链接需 -lutil
#endif
...
pid_t pid = forkpty(&master_fd, NULL, NULL, &ws);   // openpty + fork + login_tty
if (pid == 0) { execvp(argv[1], &argv[1]); _exit(127); }
// 父进程 poll {0, master, 3}：master<->stdout/stdin 中继；fd3 收 "R%d %d\n" -> ioctl(TIOCSWINSZ)
```

Bun 端（`stdio: ["pipe","pipe","inherit","pipe"]`，第 4 槽 = fd3；`proc.stdio[3]` 返回**父侧 fd 数字**，用 `fs.writeSync(fd, "R40 120\n")` 发 resize）。

**编译成单二进制、从隔离目录运行的实测输出**：

```
$ bun build --compile --target=bun-darwin-arm64 broker-driver2.ts --outfile broker-bin
$ cd /tmp/broker-iso && ./broker-bin        # 无 node_modules、无源码、无 .c
>>> sent R40 120 to control fd 8
ignored input           # ← 写进子进程 stdin 的数据被回显（双向数据 OK）
SZ=24 80                # 初始大小
GOT_WINCH:40 120        # ← SIGWINCH 被投递(bash 的 trap WINCH 触发)！
SZ=40 120               # ← resize 传播到子进程
...
=== exit(child code)=7 ===   # ← 子进程退出码 7 正确透传
```

一次拿齐 PTY 会话需要的**全部**能力，且**零 `bun:ffi`**、broker 从单二进制里自解压。

---

## 3. resize / 信号 / 退出码（针对推荐方案）

| 能力 | 结果 | 证据 |
|---|---|---|
| 真 TTY（子进程 `test -t 0`） | ✅ | `forkpty`+`login_tty` 建立控制终端；`IS_A_TTY` 打印 |
| 初始 winsize | ✅ | `SZ=24 80` |
| 动态 resize（winsize 传播） | ✅ | 发 `R40 120` 后子进程读到 `SZ=40 120` |
| **SIGWINCH 投递** | ✅ | bash `trap ... WINCH` 触发 `GOT_WINCH:40 120` |
| 子进程退出码 | ✅ | `exit 7` → broker 退出码 7；signaled 时 broker 用 `128+signum` |
| 干净 kill / 无孤儿 | ✅ | kill broker(SIGTERM) 后，`ps` 查 `sleep 30` 子进程 → `NONE`（master 关闭触发 SIGHUP 到子进程会话，自动清理） |

> 加固建议（非阻断）：broker 可再捕获 SIGTERM 主动 `killpg(子进程组)`，比依赖 master-close→SIGHUP 更确定；成本几行代码。

---

## 4. 跨平台可行性与对"单二进制分发"的影响

CLI 目标：`darwin-arm64 / darwin-x64 / linux-x64 / linux-arm64`。

- **代码可移植**：`forkpty/login_tty/openpty` 在 macOS（`<util.h>`，libSystem）和 Linux（`<pty.h>`，libutil，链接 `-lutil`）都有；broker 已用 `#if defined(__APPLE__)` 处理头文件差异。`TIOCSWINSZ`/`poll` 均为 POSIX，无需按平台改常量（不像纯 FFI 要手写各平台 ioctl 魔数）。
- **体积影响**：Bun 编译二进制本身约 **61MB**（现状即如此，与本方案无关）；内嵌的 broker 约 **50KB**，可忽略。仍是**一个**用户可执行文件，单二进制卖点**完全保留**。
- **CI 改动**：`release-cli.yml` 需在 `bun build --compile` 前，为 4 个目标各交叉编译一份 broker，然后 `import broker from "./pty-broker-<target>" with { type: "file" }` 内嵌对应架构那份。
  - macOS x64+arm64：在 macOS runner 上 `cc -arch arm64` / `-arch x86_64` 即可。
  - Linux x64+arm64：用 `zig cc -target ...` 或对应 gcc 交叉工具链（`aarch64-linux-gnu-gcc`），静态链接以避免 glibc 版本问题（`-static` 或至少 `-static-libgcc`）。broker 无第三方依赖，交叉编译很轻。
  - 运行期把内嵌 broker 写到临时目录并 `chmod +x` 再执行（已验证 `Bun.write` + `chmodSync(0o755)` 从编译二进制里自解压可行）。

---

## 5. 方案排序与工作量

| 排序 | 方案 | 单二进制 | 数据 | resize/SIGWINCH | 退出码 | 结论 |
|---|---|---|---|---|---|---|
| 1 ✅ | **内嵌原生 pty-broker（管道中继）** | 保留 | ✅ | ✅ | ✅ | **推荐**，端到端已验证 |
| 2 | 纯 `bun:ffi` openpty + 内嵌 setsid helper | 保留 | ✅ | ❌（变参 ioctl 硬伤） | ✅ | resize 走不通，除非把 ioctl 也塞进原生 helper——那不如直接上方案 1 |
| 3 | node-pty | ❌ 无法内嵌 | ❌ 读不到数据 | — | ❌ | 双重死亡，放弃 |
| 3 | forkpty-via-FFI | — | — | — | — | Bun fork 不安全，段错误，放弃 |
| 4 | 退回「Node + npm 安装」或「二进制 + 旁挂 .node」 | ❌ 放弃卖点 | ✅(用 node-pty) | ✅ | ✅ | 仅当不接受维护 C broker 时的兜底 |

**工作量估计（方案 1）**：

- 写/固化 `pty-broker.c`（≈90 行，已有可用原型）：0.5 天
- CI 交叉编译 4 目标 + 内嵌 + 自解压封装：1 天（主要是 Linux 交叉工具链/静态链接调通）
- Bun 端 TS 封装（spawn broker、pipe 读写、控制 fd 发 resize、退出码、SIGTERM 加固）+ 单测：1 天
- 合计约 **2.5～3 人日**，无需放弃单二进制。

**是否必须放弃单二进制？——不必须。** 只要接受在仓库里维护一个约 90 行、无依赖的 C 小程序并在 CI 交叉编译它。若团队坚决不想引入任何 C 编译步骤，才需退回到方案 4（Node + npm 安装 node-pty），那将失去"单二进制、用户无需 Node"这一卖点，且要重做发布流程与安装脚本——代价明显更大，不推荐。

---

## 附：本次验证用到的关键命令

```bash
bun --version                                   # 1.3.14
bun add node-pty                                # 1.1.0，prebuilds 存在
node test-echo.mjs / bun run test-echo.mjs      # Node 通 / Bun 数据为空、退出码错
bun build --compile --target=bun-darwin-arm64 … # .node 无法内嵌；FFI/broker 可
cc -O2 -o pty-broker pty-broker.c               # broker 50KB
cd /tmp/broker-iso && ./broker-bin              # 隔离运行：数据+resize+SIGWINCH+退出码全通过
```

# Agent 客户端 SDK

Agent 客户端 SDK（`packages/client/`，发布为 `@jacksonw111/agent-client`）是 better-agent 服务端的 TypeScript 客户端。它在一个完全带类型的 oRPC 链路之上提供了一组精简的接口——创建会话、运行一个回合、流式运行一个回合、取消、上传/获取附件、列出历史记录——外加一个客户端工具分派循环，让调用方能够执行本地工具以响应服务端发出的 `tool-call` 事件。

## 架构

SDK 是服务端带类型路由客户端之上的一层薄封装。它有两个平面、两个构造函数和一个流式原语：

```
createAgentClient({ baseURL, token })        agent token plane (sessions router)
        │
        ▼
createAgentClientFrom(client)                 ─┐
createUserSessionClientFrom(client, agentId)   │→ AgentClient interface
                                              ─┘   createSession / run / stream
                                                   cancel / listMessages
                                                   uploadAttachment / getAttachment

stream(text, opts) ─▶ streamPromptWithTools ─▶ for await event of sessions.prompt
                         │   on tool-call: dispatchToolCall(tools, event, submit)
                         │       └─ tool.execute(args) → sessions.submitToolResult
                         └─ yields every RunEvent to the caller
```

SDK 除了一个 `RPCLink` 之外，从不持有任何传输状态。所有认证都是在链路构造时设置的静态 `Authorization: Bearer <token>` 头。该 `token` 要么是一个 agent 令牌（`ba_…`，agent 平面），要么——对于用户平面——由 SDK 所基于的 oRPC 客户端携带用户的 access token。

### `AgentClient` 接口

`AgentClient` (`packages/client/src/types.ts:60`) 是全部公开接口：

```ts
interface AgentClient {
  cancel(sessionId: string): Promise<void>;
  createSession(): Promise<{ sessionId: string }>;
  getAttachment(id: string): Promise<Blob>;
  listMessages(sessionId: string): Promise<MessageHistory>;
  run(text: string, options?: RunOptions): Promise<RunResult>;
  stream(text: string, options?: RunOptions): AsyncGenerator<RunEvent>;
  uploadAttachment(sessionId: string, file: File): Promise<UploadedAttachment>;
}
```

`RunOptions` (`types.ts:41`) 携带 `sessionId?`（省略以自动创建一次性会话）、`signal?`（AbortSignal）、`attachmentIds?` 和 `tools?`（用于分派循环的本地 `ClientToolDef[]`）。

### 两个平面

服务端暴露两个并行的会话路由器（参见 [13-cross-cutting.md]）：

- **Agent 平面 — `sessions`**：作用域为**agent 令牌**。`createAgentClient` 构建一个带 `Bearer <agent token>` 的链路并调用 `client.sessions.*`。由 bridge CLI 和无头集成使用。
- **用户平面 — `userSessions`**：作用域为**用户 + agentId**。`createUserSessionClientFrom(client, agentId)` 复用一个已认证的 oRPC 客户端（例如 Web 应用的 cookie/bearer 客户端），并在创建会话时带 `{ agentId }` 调用 `client.userSessions.*`。由 Web 聊天使用。

两个工厂产生相同的 `AgentClient` 形态；唯一的区别是它们访问哪个服务端路由器以及会话如何被键控。这让聊天 UI（`packages/ui`）与平面无关——它只依赖于 `AgentClient`。

## 关键文件

| 文件 | 职责 |
|------|----------------|
| `packages/client/src/index.ts` | 公开导出 — `createAgentClient`、`dispatchToolCall` 以及所有类型再导出 |
| `packages/client/src/internal.ts` | `createAgentClient`、`createAgentClientFrom`、`createUserSessionClientFrom`、`dispatchToolCall`、`runWithTools` |
| `packages/client/src/types.ts` | `AgentClient`、`AgentClientConfig`、`RunOptions`、`ClientToolDef`，以及从 agent 包再导出的 `RunEvent`/`Message*` |
| `packages/client/src/tool-stream.ts` | `streamPromptWithTools` — 流 + 分派循环 |
| `packages/client/src/downscale.ts` | `downscaleImage` — 上传前在客户端调整图片尺寸 |
| `packages/client/package.json` | `exports` 映射（`.`、`./internal`），通过 tsup + dts-bundle-generator 构建 |

## 数据流

### 创建客户端

`createAgentClient({ baseURL, token })` (`internal.ts:210`)：

1. 在 `${baseURL}/rpc` 处构建一个 `RPCLink`，带 `headers: { authorization: "Bearer " + token }`。
2. `createORPCClient(link)` → 一个完全带类型的 `RouterClient<AppRouter>`。
3. `createAgentClientFrom(client)` 将其封装为 `AgentClient` 接口。

`createUserSessionClientFrom(client, agentId)` (`internal.ts:164`) 接收一个*已存在的*带类型客户端（这样 Web 应用的 token 刷新拦截器仍然生效），并将每次调用绑定到 `client.userSessions.*`，把 `agentId` 透传进 `create`。

### `stream(text, options)` — 流式协议

两个平面都将 `stream` 路由经过 `streamPromptWithTools` (`tool-stream.ts:42`)：

1. `prompt({ sessionId, text, tools: strip(options.tools), attachmentIds }, { signal })` — 调用 `sessions.prompt`（或 `userSessions.prompt`）。`tools` 被裁剪为仅 `{ name, description, parameters }` — 服务端会告知模型这些工具，但绝不接收 `execute`。
2. 迭代返回的 `AsyncIterable<RunEvent>`。**将每个事件 yield 给调用方。**
3. 遇到 `tool-call` 事件时，若 `options.tools` 已设置，将一个 `dispatchToolCall` promise 推入 `dispatches` 数组 — 流式过程中即发即忘，全部在最后 await。
4. 返回前 `await Promise.all(dispatches)`，这样生成器不会在某个工具仍在提交过程中就 resolve。

`RunEvent` (`packages/agent/src/session/events.ts:4`) 是服务端发出的可辨识联合类型：

| 类型 | 载荷 | 含义 |
|------|---------|---------|
| `message-start` | `messageId` | 创建了一条新的助手消息记录 |
| `text-delta` | `delta` | 增量的助手文本 |
| `reasoning-delta` | `delta` | 增量的推理文本 |
| `step-finish` | — | 一个模型步骤完成（可能随后有工具调用） |
| `tool-call` | `callId`, `toolName`, `args` | 模型想要调用一个（客户端）工具 |
| `tool-result` | `callId`, `result`, `isError`, `name?` | 一个工具结果到达（回传） |
| `done` | `usage`, `finishReason` | 回合完成 |
| `error` | `message` | 回合失败 |
| `title` | `title` | 会话被自动命名 |

### 客户端工具分派

`dispatchToolCall` (`internal.ts:53`) 在调用方的 `tools` 数组中按名称查找工具并执行它：

- **未找到** → `submit({ callId, result: "Tool <name> not found", isError: true })`。永不 reject。
- **抛出异常** → `submit({ callId, result: error.message, isError: true })`。
- **成功** → `submit({ callId, result, isError: false })`。

`submit` 被接线（`tool-stream.ts:61`）为调用 `sessions.submitToolResult({ sessionId, callId, result, isError })`。服务端随后带着工具结果重新进入模型，在同一条流中发出后续的 `text-delta`/`tool-call` 事件 — 因此一个多工具回合是一次 `stream()` 调用，在客户端并发发生 N 次分派。

由于分派被推入数组并在最后 await（而非内联 await），流会在工具运行时持续 yield 事件，而模型的下一步可以在服务端拿到结果后立即开始 — 该循环是流水线化的，而非严格顺序的。

### `run(text, options)` — 一次性

不带 `tools` 时，`run` 是一次 `sessions.run({ sessionId, text, attachmentIds })` 调用，返回最终的 `Message` (`internal.ts:134`)。带 `tools` 时，`runWithTools` (`internal.ts:76`) 会排干流（作为副作用分派工具），然后抓取 `listMessages` 并返回最后一条助手消息 — 因为流的最终事件是 `done`，而非消息载荷，所以消息本身必须从历史记录中读回。

### 附件

`uploadAttachment(sessionId, file)` (`internal.ts:32`) 首先运行 `downscaleImage(file)`（客户端调整尺寸以限制载荷大小），然后调用 `sessions.uploadAttachment({ sessionId, file })` → `{ id, mime, name, size }`。返回的 `id` 会在下一次 `run`/`stream` 时作为 `attachmentIds` 传入。`getAttachment(id)` 将字节以 `Blob` 形式取回（由聊天 UI 用于通过 object URL 渲染图片）。

## 设计理由

- **oRPC 带类型客户端，而非手写 fetch** — SDK 底层是 `RouterClient<AppRouter>`，因此每个输入/输出都会在编译期对照服务端路由器做类型校验。新增一个服务端 procedure 不需要任何客户端胶水代码。
- **两个构造函数，一个接口** — agent 平面和用户平面仅在路由器 + 会话键控上有差异。两者都返回 `AgentClient`，因此聊天 UI 和测试都与平面无关。
- **`run` 与 `stream` 分离** — `run` 是简单场景（无事件，只有最终消息）；`stream` 是完整的事件流。两者都支持工具：`run` 排干流并读取历史，`stream` yield 事件并以副作用方式分派。
- **流水线化的工具分派** — 工具调用在流式过程中并发分派，而非内联 await，因此慢工具不会阻塞模型的下一步或事件 yield。最终的 `Promise.all` 仅守护生成器的 resolve。
- **`dispatchToolCall` 永不 reject** — 每条失败路径（缺失工具、抛出异常）都变成一个结构化的 `{ isError: true, result }` submit。流循环中分派周围没有 try/catch，因为没有什么可捕获的。
- **发送前将工具裁剪为 schema** — 只有 `{ name, description, parameters }` 经过传输；`execute` 留在本地。服务端无法意外执行客户端工具。
- **上传前在客户端缩小图片** — 在文件到达服务端之前于客户端调整尺寸，限制了传输中的字节数和存储成本。
- **再导出领域类型** — `RunEvent`、`Message`、`MessagePart` 等从 `@better-agent/agent` 再导出，因此 SDK 的公开接口是自包含的，并与服务端的精确形态匹配。

## 配置

| 配置项 | 位置 | 默认值 | 说明 |
|------|----------|---------|-------|
| RPC 路径 | `packages/client/src/internal.ts:212` | `${baseURL}/rpc` | 追加到用户提供的 `baseURL` 之后 |
| 认证头 | `packages/client/src/internal.ts:213` | `Bearer ${token}` | 链路构造时静态设置 |
| 导出映射 | `packages/client/package.json:23` | `.`, `./internal` | `./internal` 为工作区应用暴露 `createUserSessionClientFrom` |
| 构建目标 | `packages/client/package.json:51` | tsup + dts-bundle-generator | 打包为 `dist/index.{js,cjs}` + 单个 `index.d.ts` |
| 仓库源 | `packages/client/package.json:38` | `npm.pkg.github.com` | 发布为 `@jacksonw111/agent-client` |

`./internal` 子路径导出是刻意为之的：工作区应用（web）需要 `createUserSessionClientFrom`，但外部消费者应该只看到 `createAgentClient`。这种拆分保持了公开 API 的精简，同时让第一方应用能够构建用户平面客户端。

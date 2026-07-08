# Memory 记忆系统 · 方案与计划

> 产品目标:用户在网页里创建**多个命名的 memory**(可复用的知识库);创建 agent 或 local agent 时**指派一个(或多个)memory**;一个 memory 可被多个 agent 共享。所以 memory 是**可命名、可指派、可共享的一等资源**,不是隐藏的会话缓冲。
> 技术栈:Postgres + Drizzle(可用 pgvector)、oRPC、部分服务在 Cloudflare Workers(边缘、无长驻进程,嵌入/LLM 走 API)、TS/Node。
> 本文把有争议的地方做成**决策点(选项 + 优缺点)**,由你选;其余给出我的推荐架构和分阶段计划。

---

## 一、结论先行(我的推荐)

**自建一层薄记忆服务,建在 Postgres + pgvector 上**,借用两套成熟算法在 TS 里重写:Mem0 的"抽取 → 决策(ADD/UPDATE/DELETE)"写入循环,和 Generative-Agents 的加权检索分。**读在边缘,写/整合在 Node**。**v1 先做"用户策划的知识库",自动捕获推后。**

为什么不直接用现成库:所有成熟系统(Mem0/Letta/Zep/Cognee)都是 **Python** 和/或绑 **图数据库**,"采用"就等于多跑一个 Python sidecar;而我们真正要建的"可命名/可指派/可共享的 memory 对象"作用域,**没有任何库是这么做的**(它们都是 `user_id`/`agent_id` 标签),这块无论如何要自建。算法本身很小,TS 重写比运维外部 runtime 便宜,还全程留在我们已有的 Postgres/Neon 里。

---

## 二、决策点(请你选)

### 决策 A:v1 要不要做「自动捕获」(从对话里自动抽取记忆)?

| 选项 | 优点 | 缺点 |
|---|---|---|
| **A1 · 只做用户策划(手写)** 〔推荐〕 | 砍掉整个系统最难/最贵/边缘跑不了/最难评测的一步(LLM 决策 ADD/UPDATE/DELETE);共享 memory 不会被自动写污染;能快速上线差异化的"共享知识库" | 内容靠手录,前期积累慢;不够"自动智能" |
| **A2 · v1 就做自动捕获**(Mem0 式每轮抽取 + 去重更新) | 开箱即用、内容自动积累、更"智能" | 最难最贵;**共享 memory 腐烂风险最高**(多 agent 写,矛盾/重复快速堆积);边缘跑不了,要放 Node + 队列;没真实流量前无法评测质量 |

> 我的倾向:**A1**。先把策划式知识库稳稳发出去;自动捕获做成 v1.1 里**每个 memory 可选的开关 + 人在环里审**。

### 决策 B:agent 怎么「用」memory(接入方式)?

| 选项 | 优点 | 缺点 |
|---|---|---|
| **B1 · 检索注入(RAG)** | 简单;对所有 agent(含 local)通用,不需要 agent 支持工具;被动生效 | 占上下文;agent 不能主动查/写;每轮注入可能塞进不相关内容 |
| **B2 · memory 做成 MCP 工具** 〔推荐〕 | **复用我们已有的 MCP server**;web agent 和 local agent(claude-code/opencode 经 bridge)**走同一接口就都有记忆**;agent 按需主动查/写 | 依赖 agent 支持 MCP/工具;agent 可能不主动调 |
| **B3 · 两者都做** | 被动 + 主动兼得,最完整 | 实现量最大 |

> 我的倾向:**B2 为主**(memory 作为 MCP 工具 `memory_search`/`memory_add`,一举统一两类 agent),web 侧可加 B1 检索注入作为补充。

### 决策 C:指派语义(一个 agent 能配几个 memory?只读还是读写?)

| 选项 | 优点 | 缺点 |
|---|---|---|
| **C1 · 一对一、只读** | 最简单 | 不能共享给多 agent、不能写、不灵活 |
| **C2 · 多对多、默认只读、读写为显式选项** 〔推荐〕 | 灵活;支持"一个知识库多个 agent 共享";可控制谁能写 | 略复杂(需要一个关联表带 role) |

> 我的倾向:**C2**(关联表 `agent_memories` 带 `role: 'read' | 'read_write'`)。

### 决策 D:嵌入(embedding)用什么?

| 选项 | 优点 | 缺点 |
|---|---|---|
| **D1 · Cloudflare Workers AI 原生 embedding(bge)** 〔倾向〕 | **读路径全在边缘**、不出边缘调外部 API、走 CF 无额外 key | 模型/维度受限、质量可能略逊、绑定 CF |
| **D2 · 外部 API(OpenAI text-embedding-3-small,1536 维)** | 质量好、通用、维度可选 | 读路径要从边缘调外部 API(延迟 + key + 成本) |

> 我的倾向:**D1**(读全在边缘更契合我们的拓扑;质量不够再换 D2 —— schema 把 embedding 拆成独立表,换模型/重嵌不动事实数据)。

### 决策 E:检索打分方式?

| 选项 | 优点 | 缺点 |
|---|---|---|
| **E1 · 纯相关性 kNN** 〔v1 推荐〕 | 最简单;对**策划的知识库**足够 | 不考虑重要性/新鲜度 |
| **E2 · 加权分(近因 + 重要性 + 相关性)** | 更"聪明"(Generative-Agents) | **近因衰减对策划知识库反直觉**——一条"用户偏好 TypeScript"的事实不该随时间过期;更适合自动捕获的会话记忆 |

> 我的倾向:**E1 + 用户置顶/importance**;近因衰减只对将来"自动捕获的会话类条目"开(那才符合衰减的语义)。

---

## 三、推荐架构(基于以上倾向)

### 3.1 存储 Schema(Drizzle,沿用现有约定:`uuid().defaultRandom()`、`timestamptz`、`jsonb`)

```
memories              -- 命名、可指派的对象
  id, user_id(owner), name, description, created_at/updated_at

agent_memories        -- 多对多关联(web agent 与 bridge/local agent 复用)
  agent_id, memory_id, role('read'|'read_write'), pk(agent_id, memory_id)

memory_items          -- 原子事实(检索的单位)
  id, memory_id(fk), content, source('user'|'extracted'|'reflection'),
  importance real default 0.5, valid_from, valid_to(软删,null=当前),
  last_accessed_at, metadata jsonb(标签/关键词), created_at/updated_at

memory_embeddings     -- 拆表,便于重嵌/换模型
  item_id(fk), embedding vector(N)(pgvector, HNSW 索引), model
```
> pgvector 走**迁移**(`db:migrate` 不是 `db:push`,扩展 + HNSW 索引要显式 SQL)。embedding 拆表 = 换嵌入模型/A-B 测试不用重写事实。

### 3.2 读路径(边缘安全)
1. 嵌入 query(1 次调用,Workers AI 或外部 API,见决策 D)。
2. 对 `memory_embeddings` 做 pgvector kNN,按 agent 已指派的 `memory_id` + `valid_to IS NULL` 过滤,取 top-k。
3. v1 纯相关性排序返回(决策 E)。
4. (可选)命中项 bump `last_accessed_at`。

### 3.3 写路径
- **v1(决策 A1):用户手写** —— 边缘可做:一次嵌入 + INSERT(`source='user'`)。无 LLM reconcile。
- **v1.1 自动捕获(可选开关):** Worker 入队 `{memory_id, 对话片段}` → **Node** 跑 Mem0 式抽取 → 对每条候选做 kNN top-k → LLM 决策 ADD/UPDATE/DELETE/NOOP → 应用(UPDATE/DELETE = 置 `valid_to` + 插后继)。
- **v2 整合/反思(定时 Node 任务):** 聚类近期条目 → LLM 摘要成 `source='reflection'` 条目;按需衰减/清理。

### 3.4 接入(决策 B2)
- **memory MCP server**:`memory_search(memory_id?, query, k)` / `memory_add(memory_id, content)`。web agent 和 local agent 都通过 MCP 调用 → 两类 agent 统一有记忆。
- web 侧可选叠加**检索注入**(每轮把 top-k 塞进上下文)。
- 权限:agent 只能读/写它被指派、且 role 允许的 memory_id(server 侧校验)。

---

## 四、分阶段计划

| 阶段 | 内容 | 边缘/Node |
|---|---|---|
| **M1 · MVP(策划式知识库)** | `memories`+`agent_memories`+`memory_items`+`memory_embeddings` schema(迁移);用户手写条目;纯 kNN 检索(按 memory_id 过滤);**指派 UI**(创建 agent/local agent 时选 memory);memory 管理页(建/删/看/编辑条目) | 读边缘、写边缘(仅手写) |
| **M2 · MCP 接入** | memory MCP server(search/add)+ 能力/权限门控;web 检索注入(可选) | Node/MCP worker |
| **M3 · 自动捕获(每 memory 可选)** | 入队 + Node 侧 Mem0 式 抽取→reconcile(ADD/UPDATE/DELETE);软删可恢复;UI 里可见可改(人在环) | 写在 Node |
| **M4 · 整合/衰减** | 定时反思/摘要(RAPTOR/Generative-Agents);MemoryBank 式衰减(仅自动捕获条目);可选 `memory_links`(A-MEM)+ 递归 CTE 多跳 | Node |

> M1 就是一个可上线、有差异化的"共享知识库"功能。自动捕获(M3)是最难的一块,故意推后并做成可选。

---

## 五、最大风险(要盯住的)

**共享 memory 的写入质量与成本。** 被多个 agent 读的 memory 腐烂最快(矛盾/重复,一个 agent 的噪音污染另一个)。整套系统的成败押在 LLM 的 `ADD/UPDATE/DELETE` reconcile 那一步——它既跑不了边缘、又要有真实多 agent 流量才能评测。缓解:① 早点搭 LOCOMO/LongMemEval 式评测集;② 保留软删(`valid_to`),坏 reconcile 可恢复;③ **memory UI 让用户能看到并修正条目**(人在环是最便宜的质量杠杆,而我们本来就有这个 UI 面)。次要风险:pgvector 在 Neon serverless(HTTP 驱动)上从 Worker 查的召回/延迟——上线前用真实行数基准测 HNSW。

---

## 六、需要你定的(汇总)

- **A**:自动捕获 v1 做不做?(我倾向 A1:先只做手写)
- **B**:接入走 MCP 工具 / 检索注入 / 两者?(我倾向 B2:MCP)
- **C**:一个 agent 配几个 memory、只读还是读写?(我倾向 C2:多对多、默认只读)
- **D**:嵌入用 Workers AI 还是外部 API?(我倾向 D1:Workers AI)
- **E**:检索纯 kNN 还是加权分?(我倾向 E1:纯 kNN + 置顶)

你就上面 A–E 各选一个(或直接说"按你推荐来"),我就按 brainstorming → spec → plan 正式把它落成和现有代码同规格的实现,从 M1 开始。

---

*调研依据:Mem0(arXiv:2504.19413)、MemGPT/Letta(2310.08560)、Zep/Graphiti(2501.13956)、Generative Agents(2304.03442)、A-MEM(2502.12110)、MemoryBank(2305.10250)、HippoRAG(2405.14831)、RAPTOR(2401.18059),及 pgvector。*

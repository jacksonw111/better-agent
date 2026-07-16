# QuantSkills → finance-mcp / Skills 集成方案

> 调研 + 方案。目标:从 `quantskills/quantskills` 组织(80+ 仓库)中,(1) 提炼可加入 **finance-mcp** 的数据工具;(2) 挑选并把它的 **skill** 改写成适配本项目 skill 系统的版本,支持**一键导入**。
> 日期:2026-07-15 · 分支:dev

---

## 1. QuantSkills 是什么(调研结论)

`quantskills/quantskills`(⭐148)本身只是一个**组织全景导航仓库**(README 由 `scripts/build.mjs` 自动生成),真正的资产是 org 下 **~80 个 `skill-*` / `agent-*` 仓库**。

**关键事实 —— 它们的数据层是 Pandadata(盘达),不是我们的 finance-mcp。** 几乎每个 skill 的 frontmatter 都写 `requires: [skill-pandadata-api]`,workflow 里调用的是 `panda_data` 的 Python 方法(`get_index_daily` / `get_lhb_list` / `get_margin` …),并配 `scripts/*.py` 做本地计算与报告校验。

**它们的 skill 格式**(Anthropic Agent Skill,面向 Claude Code / Codex / Cursor 等**能跑代码**的宿主):
```
SKILL.md                 # frontmatter(name/description/license/metadata) + Workflow + Rules
references/*.md          # API map、报告模板、风险阈值、QA checklist
scripts/*.py             # 数据调用 + 计算 + 报告校验(call_api.py / validate_report.py)
agents/{openai.yaml,cursor-rule.mdc,portable-loader.md}   # 各宿主适配
```

**我们的 skill 格式**(指令驱动的 MCP agent skill,**不跑代码**):平台已落地 skill 系统 —— `packages/agent/src/skill-ports.ts` 定义 `SkillRow = { name, description, instructions, allowedTools?, mcpServerIds? }`,`/skills` 页面 CRUD,`/skill-name` 激活(见 `session/skill-activation.ts`、`docs/web-agent-skills-plan.md`)。数据全部来自 `finance_*` MCP 工具。参考实现:`docs/skills/stock-research-skill.md`。

### 核心差异(决定"怎么改写")
| 维度 | QuantSkills | 本项目 |
|---|---|---|
| 数据源 | Pandadata `panda_data.*`(Python) | finance-mcp `finance_*`(MCP tool) |
| 执行 | 跑 Python 脚本算指标/回测/校验 | 纯指令,模型直接调 MCP 工具、口算派生指标 |
| 交付物 | SKILL.md + references + scripts + 各宿主 loader | 一份 skill 记录(instructions 大 prompt)|
| 适配动作 | —— | **把数据访问层从 `panda_data.get_*()` 重写成 `finance_*` 调用**,方法论/报告结构/风险规则**照搬** |

**结论:不能直接搬运,但方法论价值极高。** 每个 analyst/monitor 类 skill 的"工作流 + 报告模板 + 风险阈值"就是一份高质量的行业 SOP,我们复用 SOP、替换数据层即可。factor/backtest 类因依赖代码执行,不纳入。

---

## 2. 可提炼进 finance-mcp 的数据工具(gap 分析)

把 QuantSkills 高价值 skill 依赖的 Pandadata 方法,对照我们现有 66 个 `finance_*` 工具,**已覆盖的不动,缺的才建**。已 grep 核实以下 5 项均**当前缺失**。

| # | 建议新工具 | 覆盖的 Pandadata 方法 | 服务哪些 skill | **确定数据源 + 复用模块** | 优先级 |
|---|---|---|---|---|---|
| T1 | `finance_trade_calendar` | `get_trade_cal` / `get_last_trade_date` | 复盘、事件预警、所有定时自动化 | **从指数 K 线派生**(不引新上游):复用 `tencent/kline.ts` + `tencent/indices.ts`(上证综指 `sh000001`)。最近交易日=最新 bar 日期,== 今天则开市;某历史日在日期集合内即交易日。未来 N 交易日 P0 用「工作日−内置节假日表」近似,完整前瞻日历留 Phase 2 | **P0**(基础设施,多 skill 依赖)|
| T2 | `finance_market_breadth` | `get_stock_daily` 全市场聚合 | 复盘、市场状态、选股 | ① 涨/跌停·炸板·连板梯队·断板率 = **现成** `getLimitUpSentiment`(`push2ex.eastmoney.com`,`limit-up.ts` 已 VERIFIED live);② 涨/跌/平家数 + 涨跌幅分布桶 = EastMoney **`clist/get`** 全 A(`fs=` 过滤,`f3`=涨跌幅,JS 计数)——**已在 `sector.ts`/`stock-boards.ts`/`etf.ts`/`options.ts` 用**。⚠️**实测:`1.push2` 镜像每页硬顶 100 行(`pz` 无效),但回 `data.total`(~5877)**,故按 `pn` 分页(pz=100,`fid=f12` 稳定排序),限并发 8、上限 80 页,套 `core/cache.ts` 120s 缓存 | **P0** |
| T3 | `finance_share_pledge` | 质押相关 | 个股尽调、事件风险预警 | eastmoney `datacenter-web` 股权质押(RPT_CSDC_*),待 Phase 2 核验 live 端点 | P1 |
| T4 | `finance_index_valuation` | `get_index_indicator`(PE/PB 分位) | 指数估值轮动、组合体检 | 中证/eastmoney 指数估值分位,待 Phase 2 核验 | P1 |
| T5 | `finance_hk_us_insider` | 港美内部人 | 港美内部人雷达 | SEC Form 4 / HKEX CCASS(现 insider 仅 A) | P2 |
| T6(选) | `finance_iv_metrics` | 期权 IV/HV/期限结构/skew | 期权波动率分析 | 基于现有 `finance_option_chain` 派生 | P2 |

> P0 两个工具的数据源均落在**已验证的 EastMoney/腾讯免费线**上,不碰 Pandadata、不加付费源、不引新依赖。
> 说明:`finance_market_breadth`(全市场涨跌家数)是复盘/选股类 skill 的核心缺口 —— 现有工具都是**按 symbol**查询,无**全市场快照**。这是把复盘类 skill 做扎实的关键前置。其余(龙虎榜/大宗/两融/北向/分红/解禁/减持/研报/宏观/情绪/期权链)**我们已全部覆盖**,直接复用。

**期货/商品期限结构**类(`skill-futures-deepview-analyst`、`global-commodity-term-structure`)依赖我们尚无的期货持仓/基差/库存数据 —— 单独立项,不在本轮。

---

## 3. Skill 移植清单(改写成本项目格式)

按"可移植性"分三档。可移植 = 分析型/监控型,数据能映射到 `finance_*`。

### A 档 —— 直接可移植(数据已覆盖或仅需 T1/T2)
| QuantSkills skill | ⭐ | 改写成本项目 skill | 依赖新工具 | 与现有重叠 |
|---|---|---|---|---|
| skill-market-daily-review | 33 | `market-review`(A股收盘复盘) | T1,T2 | 新 |
| skill-a-share-stock-dossier | 18 | `stock-dossier`(个股尽调) | T3 | 与 `stock-research` 部分重叠,做"尽调/风险"变体 |
| skill-macro-monitor | — | `macro-monitor`(宏观监控) | — | 复用 macro_us/cn/yield_curve |
| skill-earnings-season-tracker | — | `earnings-season`(财报季扫描) | T1 | 复用 preannounce/forecast/calendar |
| skill-smart-money-profiler | 1 | `smart-money`(主力资金画像) | — | 复用 dragon_tiger/hsgt/top_holders |
| skill-block-trade-radar | — | `block-trade-radar`(大宗折溢价) | — | 复用 block_trades |
| skill-event-risk-alert | — | `event-risk`(事件风险预警) | T1 | 复用 lockup/insider/suspension |
| skill-portfolio-checkup | — | `portfolio-checkup`(组合体检) | T4 | 复用 key_metrics/indicators |
| skill-fin-news | — | `fin-news`(财经资讯撰稿) | — | 复用 news/stock_news/industry_news |

### B 档 —— 需 P1/P2 工具后可移植
| skill-index-valuation-rotation ⭐2 → `index-rotation`(T4)· skill-options-vol-analyst ⭐4 → `options-vol`(T6)· skill-hk-us-insider-radar → `insider-radar`(T5)· skill-stock-screener → `stock-screener`(T2 全市场快照)· skill-market-regime-analysis → `market-regime`(T2)· skill-us-sec-edgar-harvester → 复用现有 sec_filings/sec_facts · global-macro-rates-fx-lab → 复用 FRED 工具 |

### C 档 —— 不移植(依赖代码执行/回测/因子计算/本地数仓)
所有 `skill-factor-*`、`skill-alpha*`、`skill-backtest*`、`skill-risk-model`、`skill-portfolio-optimize`、`agent-quantspace`、`skill-pandadata-warehouse`、`skill-jq-to-panda-converter`、`skill-pandaai-workflow-*`、`skill-numerical-leak-check`、`skill-time-series-analysis`、`skill-doc-to-alphas`、`skill-*-replication`、`skill-xingtai-catcher`(自带独立 MCP)。这些需要 Python 计算/回测引擎/DuckDB 数仓,与"指令+MCP"模型不匹配。
> 研究模型类(serenity / gao-shanwen / x-trader-builder)本质是"从 X 重建某分析师研究逻辑",**我们有 x-mcp**,理论可移植,归入未来轮次。

**首轮建议落地 A 档 9 个 skill**(全部只依赖 T1/T2/T3,价值密度最高)。

---

## 4. 「一键导入」机制 —— 启动时内置到数据库(已定)

**决策:系统启动时把内置 skill seed 进数据库,已存在则跳过(幂等)。** 不用 CLI 脚本、不用 UI 按钮。

现状约束:`skills.userId` 是 `NOT NULL → users.id`(见 `packages/db/src/schema/skills.ts`),skill 是**按用户归属**的;而内置 skill 要对**所有客户**可见。因此需要"内置/全局 skill"概念。设计:

1. **schema 加 `isBuiltin boolean not null default false`**,并把 `userId` 改为 **nullable**(内置 skill 无 owner)。迁移用 `db:generate` + `db:migrate`(遵循 [[better-agent-local-db-shared]]:用 migrate 不用 push)。
2. **skill 定义内置在代码里**:`packages/agent`(或 `apps/server`)下一个 `builtin-skills/` 目录,每个 skill 一个 TS 常量(`{ name, description, instructions, allowedTools, mcpServerIds }`),汇总成 `BUILTIN_SKILLS` 数组。改文本 → 改代码 → 重启同步。
3. **启动 seed**:仿 `apps/server/src/seed-admin.ts`,新增 `seed-skills.ts`,在部署 Action 迁移后(或 server 启动时)遍历 `BUILTIN_SKILLS`,**按 `name` + `isBuiltin=true` upsert**(存在则更新 instructions/desc,不存在则插入),`userId=null, isBuiltin=true`。幂等,重复启动安全。
4. **读取放行**:`SkillStore.listByUser` / `/skills` 列表查询改为 `userId = me OR isBuiltin = true`;内置 skill 对用户**只读**(update/delete 仍 owner-scoped,内置项禁止改删,或"复制为我的"再改)。`assignAgent` 允许挂内置 skill。
5. **mcpServerIds 处理**:内置 skill 依赖 finance-mcp(+可选 x-mcp)。内置 skill 不硬编码某用户的 serverId,改为**按 `allowedTools` 里的 `finance_*` 前缀**在激活时解析,或提供"内置 finance-mcp server"引用。此点在 Phase 1 T3 细化。

> 备选(若不想动 schema):seed 到一个**保留系统用户**并在列表查询里 union 该系统用户的 skill。但 `isBuiltin` 标记更清晰,推荐主方案。

---

## 5. 落地计划(SDD 分阶段)

**Phase 0 — 基础工具(P0)· ✅ 已完成(2026-07-15)**:`finance_trade_calendar`(T1)+ `finance_market_breadth`(T2) 已实现并接线。core 模块 `core/market/{trade-calendar,breadth}.ts` + `tool-defs-market-stats.ts` + `tools-impl-market-stats.ts`,挂进 `V6_HANDLERS` 与 mcp-server 侧效应导入。12 个新单测 + 全量 411 测试通过,typecheck/lint 干净。两个上游端点均 live 核验(T1 sh000001 日 K 拿到最近交易日;T2 clist 镜像 100 行/页 → 已改分页)。**待用户在部署态实测**(见 [[dev-first-workflow]])。

**Phase 1 — 内置 skill 基建 + A 档 9 个移植 · ✅ 已完成(2026-07-15)**:
1. ✅ schema:`skills` 加 `isBuiltin` + `userId` 改 nullable(迁移 `0043_lovely_invaders.sql`,已 `db:migrate` 应用)。`SkillStore` 加 `upsertBuiltin`(幂等按 name)、`listByUser` 放行 owned+builtin;router 分 `requireReadableSkill`(get/assign/unassign 放行内置)与 `requireOwnedSkill`(update/delete 仍 owner-only → 内置只读);`bridge-skills-resolve` 同步放行;`fake-skill-store` 补齐。
2. ✅ `apps/server/src/builtin-skills/` 9 个 `.md`(1254 行)+ `manifest.ts`(name/description/allowedTools/file)。由 9 个并行子代理各移植一个 QuantSkills 仓库,只借鉴方法论、全新改写、数据层重写为 `finance_*`。50 个 allowedTools 全部核验为真实注册工具(无拼写/幻觉)。
3. ✅ `seed-skills.ts`(tsx 读 `.md` + `upsertBuiltin`)+ 折进 compose `migrate` 一次性服务(`node dist/migrate.mjs && pnpm exec tsx src/seed-skills.ts`,server 依赖其完成)。
4. ✅ 端到端实测:本地 DB 迁移 + seed → 9 个内置 skill(owner=null,instr 4.7–6.5k 字符,tools 数对);再跑一次仍 9 个(幂等)。web 内置 skill 显示「内置/只读」徽标、隐藏删改。全量测试通过(db 134 / api 274 / agent 191 / web / finance-mcp 411),lint+typecheck 干净。**待用户在部署态挂 agent 激活实测**(见 [[dev-first-workflow]])。

**Phase 2 — P1 工具 · ✅ 已完成(2026-07-15)**:
- ✅ **`finance_share_pledge`(T3)**:`core/eastmoney/pledge.ts`(EastMoney datacenter-web `RPT_CSDC_LIST`,per-stock 质押比例%/质押市值/待购回,按结算日,live 核验)。回填进 `stock-dossier`(20 工具)与 `event-risk`(11 工具,新增「股权质押/平仓风险」事件类),替换原「暂无质押数据」。⚠️ 中登披露有滞后(实测最新 ≈2024-04),工具与 skill 均强制按 as-of 结算日标注、数据过旧降级提示。
- ✅ **`finance_index_valuation`(T4)**:`core/legulegu/index-valuation.ts` —— 数据源用 akshare 同款 **legulegu(乐咕乐股)**,扒了它的鉴权:GET HTML 页拿 `<meta _csrf>` + cookie,API 带 `token=md5(北京当日)` + CSRF 头。返回宽基指数 PE(TTM/静态)+PB 及**预算好的历史百分位** + 估值研判(低估/偏低/合理/偏高/高估)。**live 端到端核验**(沪深300/中证500/上证50/创业板50 均返回真实分位)。MD5 复用 `core/cls/md5.ts`(Workers 无原生 MD5)。新增 **`index-rotation`** 内置 skill(指数估值分位+行业轮动,7 工具),并回填进 `portfolio-checkup`(11 工具,基准估值分位)。
- **内置 skill 总数 10 个**,已 re-seed 本地 DB 验证(幂等)。finance-mcp 423 测试过,lint 干净。⚠️ 注意:`apps/server` 的 `tsc -b` 当前被**并发 agent 的 computerControl 特性**(改了 AgentServices/index.ts)阻断,与本工作无关;finance-mcp 独立 typecheck 干净。

**Phase 3 — 期权波动率 · ✅ 已完成(2026-07-15)**:
- ✅ **`finance_volatility`(T6 的 HV 半块)**:`core/technical/volatility.ts` —— 由日K计算年化历史/已实现波动率 HV,多窗口(20/60/120/250日)+ 20日HV 一年历史分位。**纯自算,零新增外部源**(复用 tencent kline)。live 核验(50ETF/茅台/AAPL 均返回合理年化vol + 分位)。IV 侧我们本已有(`finance_option_quote` A股ETF期权 greeks+IV、`finance_us_options` 美股 IV),HV 补齐后可算**波动率溢价(IV−HV)**。
- ✅ 新增 **`options-vol`** 内置 skill(IV vs HV 溢价、期限结构、偏斜 skew、希腊字母,覆盖 A 股 ETF 期权 + 美股)。
- **内置 skill 总数 11 个**,re-seed 验证。finance-mcp 429 测试过。

**Phase 4 — 美股内部人 · ✅ 已完成(2026-07-16)**:
- ✅ **`finance_us_insider`(T5 的美股半块)**:`core/openinsider/insider.ts` —— 美股 SEC Form 4 内部人交易,数据源 **OpenInsider**(标准免费聚合站),per-ticker 一次请求 → 申报日/交易日/内部人/职务/交易类型(P买/S卖,`side`)/价格/带符号股数/金额/持股变动。正则解析其 `tinytable`(Worker 无 DOM),失败降级 []。live 核验(AAPL/NVDA 解析正确)。⚠️ OpenInsider 仅 http(无 https)——Worker 支持 http 子请求,codebase 已有 http 端点先例。填补真实缺口(原 `finance_insider_trades` 仅 A 股)。
- ⏸️ **港股 insider 不做**:HKEX CCASS/权益披露无干净免费源,工具与 `us-insider` skill 均诚实标注「仅美股」。
- ✅ 新增 **`us-insider`** 内置 skill(集中买入信号/关键人动向/主动买入 vs 期权行权噪音/结合股价位置)。
- **内置 skill 总数 12 个**,re-seed 验证。finance-mcp 433 测试过。

**已新增 finance 工具汇总(6 个)**:`finance_trade_calendar`、`finance_market_breadth`、`finance_share_pledge`、`finance_index_valuation`、`finance_volatility`、`finance_us_insider`。
**已上线内置 skill(12 个)**:market-review · stock-dossier · macro-monitor · earnings-season · smart-money · block-trade-radar · event-risk · portfolio-checkup · fin-news · index-rotation · options-vol · us-insider。

**Phase 5(可选)** — 期货数据线(持仓/基差/库存,大工程)、研究模型类 skill(接 x-mcp,零新数据源)、港股 insider(待稳定源)。

### 已定决策
1. **范围**:A 档 9 个 skill + T1/T2 两个工具。
2. **导入**:启动时 seed 进 DB、幂等跳过(§4);内置为全局只读 skill。
3. **许可证**:只借鉴方法论、全新改写,不复制其代码/文本。

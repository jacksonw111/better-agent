# finance-mcp

A股 / 港股 / 美股金融数据 MCP 服务器：75 个工具，覆盖行情、基本面、市场宽度、资金流向、期权、宏观、新闻舆情与预测市场。基于 Hono 构建，同一套代码同时跑在 Node（Docker）和 Cloudflare Workers 上。

## 服务端点

| 端点 | 说明 |
| --- | --- |
| `POST /mcp` | MCP 主入口（Streamable HTTP，无状态 JSON 模式） |
| `GET /api/*` | REST 门面，与 MCP 工具共享同一套核心取数函数 |
| `GET /pdf` | PDF 代理（研报 / 定期报告直链转发） |
| `GET /` | 健康检查，返回服务名与工具数量 |

MCP 协议版本 `2025-06-18`。每个 POST 携带一条 JSON-RPC 消息（`initialize` / `ping` / `tools/list` / `tools/call`），响应为 `application/json`，服务端不保存会话状态。

## 鉴权

所有 `/mcp`、`/api/*`、`/pdf` 请求都经过共享 token 校验（环境变量 `API_TOKEN`；未设置时开放访问）。三种传递方式任选其一：

```
Authorization: Bearer <API_TOKEN>     # 推荐
X-Api-Token: <API_TOKEN>
?token=<API_TOKEN>                    # query 参数
```

## 接入方式

### Claude Code

```bash
claude mcp add finance --transport http https://<host>/mcp \
  --header "Authorization: Bearer <API_TOKEN>"
```

### 通用 MCP 客户端配置

```json
{
  "mcpServers": {
    "finance": {
      "type": "http",
      "url": "https://<host>/mcp",
      "headers": { "Authorization": "Bearer <API_TOKEN>" }
    }
  }
}
```

### 直接用 curl 调试

```bash
# 列出全部工具
curl -s https://<host>/mcp \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 调用工具：查茅台实时行情
curl -s https://<host>/mcp \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"finance_quote","arguments":{"symbol":"600519.SH"}}}'
```

## 代码格式约定

| 市场 | 格式 | 示例 |
| --- | --- | --- |
| A股（沪） | `代码.SH` | `600519.SH` |
| A股（深） | `代码.SZ` | `000001.SZ` |
| A股（北） | `代码.BJ` | `430047.BJ` |
| 港股 | `代码.HK` | `00700.HK` |
| 美股 | 裸 ticker | `AAPL`、`BRK-B` |

不知道代码时，第一步永远是 `finance_search`（A股 EastMoney + 美股 Yahoo 并行合并，中英文均可，如 `茅台` / `apple` / `NVDA`）。

## 工具目录（75 个）

### 搜索与行情

| 工具 | 说明 |
| --- | --- |
| `finance_search` | 股票搜索（A股 + 美股 EQUITY/ETF，返回 code/name/exchange/market） |
| `finance_quote` | 实时行情快照（US/HK/A股）：最新价、涨跌幅、OHLC、五档盘口 |
| `finance_kline` | 历史 K 线 OHLCV（日/周/月 + 1m–60m 分钟线） |
| `finance_technical` | 技术指标（MA/MACD/KDJ/RSI/BOLL 等） |
| `finance_index_quote` | 全球主要指数快照（A股/港股/美股/欧洲） |
| `finance_commodity` | 大宗商品行情（黄金、原油等） |
| `finance_volatility` | 历史/已实现波动率 HV（20/60/120/250 日多窗口 + 一年分位，A/港/美通用） |

### 基本面与财报

| 工具 | 说明 |
| --- | --- |
| `finance_key_metrics` | 估值快照：PE(TTM/静/forward)、PB、PS、PEG、市值；美股另含 beta/股息率/52周高低 |
| `finance_company_profile` | 公司资料（A股 F10 / 美股 Yahoo） |
| `finance_financial_statements` | 财务三表（A股每期 / 美股 SEC XBRL 年度 10-K） |
| `finance_financial_indicators` | 关键财务指标：EPS、营收/净利同比、毛利率、ROE、负债率（基本面首选） |
| `finance_list_reports` | A股定期报告列表（含 PDF 直链，可配合 `/pdf` 代理下载） |
| `finance_earnings_forecast` | 机构盈利预测 |
| `finance_earnings_preannounce` | A股业绩预告 |
| `finance_sec_facts` | SEC XBRL 原始财务数据（任意 us-gaap 指标多年审计值） |
| `finance_sec_filings` | SEC EDGAR 文件列表（10-K/10-Q/8-K 等，含直链） |
| `finance_dividends` | A股分红送转历史（美股股息走 `finance_sec_facts`） |

### 研报、股东与公司治理

| 工具 | 说明 |
| --- | --- |
| `finance_research` | A股个股券商研报（评级、EPS/PE 预测、PDF 链接） |
| `finance_analyst_ratings` | 分析师评级汇总 |
| `finance_top_holders` | 十大股东 / 十大流通股东 |
| `finance_institutional_holders` | 机构持仓 |
| `finance_holder_count` | 股东户数变化 |
| `finance_insider_trades` | A股高管/重要股东增减持 |
| `finance_investor_qa` | 投资者互动问答（董秘答复） |
| `finance_announcements` | 上市公司临时公告 |

### A股市场统计

| 工具 | 说明 |
| --- | --- |
| `finance_trade_calendar` | A股交易日历（今天是否交易日、最近交易日） |
| `finance_market_breadth` | A股全市场宽度：涨跌家数、涨跌停、涨跌幅分布 |
| `finance_limit_up_pool` | 涨停池 |
| `finance_limit_up_reasons` | 涨停原因归类 |
| `finance_limit_up_sentiment` | 打板情绪指标（连板高度、晋级率） |
| `finance_strong_stocks` | 强势股池 |
| `finance_index_valuation` | 指数估值（PE/PB 历史分位） |
| `finance_index_weights` | 指数成分权重 |
| `finance_share_pledge` | 股权质押 |

### 美股专属

| 工具 | 说明 |
| --- | --- |
| `finance_m7` | 美股七巨头 Magnificent 7 一键快照：价格、涨跌、市值、PE、52周位置 + 市值加权涨跌 |
| `finance_us_trade_calendar` | 美股交易日历（美东时区） |
| `finance_us_market_breadth` | 美股全市场宽度（NASDAQ+NYSE+AMEX 约 7000 只，实时快照，不支持历史日期） |
| `finance_us_insider` | 美股内部人交易（OpenInsider） |
| `finance_us_options` | 美股期权链（Yahoo）：行权价、bid/ask、IV、全部到期日 |

### 期权（A股 ETF）

| 工具 | 说明 |
| --- | --- |
| `finance_option_chain` | 期权链（50/300/500 ETF 认购认沽，不含希腊字母） |
| `finance_option_contracts` | 合约代码清单（按到期月分组） |
| `finance_option_quote` | 单合约详情：T 型报价 + 希腊字母 + IV + 理论价值 |

### 资金流向

| 工具 | 说明 |
| --- | --- |
| `finance_money_flow` | 个股/板块资金流（主力、大中小单） |
| `finance_hsgt_flow` | 沪深港通资金流向 |
| `finance_margin` | 融资融券余额 |
| `finance_block_trades` | 大宗交易 |
| `finance_dragon_tiger` | 龙虎榜 |

### 板块与品种

| 工具 | 说明 |
| --- | --- |
| `finance_sector_list` | 行业/概念板块列表及涨跌 |
| `finance_sector_constituents` | 板块成分股 |
| `finance_stock_boards` | 个股所属板块/概念 |
| `finance_hot_concepts` | 热门概念 |
| `finance_etf_list` | ETF 列表 |
| `finance_convertible_bonds` | 可转债 |

### 事件与日历

| 工具 | 说明 |
| --- | --- |
| `finance_earnings_calendar` | 财报发布日历（A股/港股/美股） |
| `finance_economic_calendar` | 美国宏观数据发布日历（CPI/非农/FOMC 日期） |
| `finance_ipo` | 新股 IPO |
| `finance_lockup` | 限售解禁 |
| `finance_suspension` | 停复牌 |

### 宏观

| 工具 | 说明 |
| --- | --- |
| `finance_macro_us` | 美国宏观指标（FRED）：CPI、PCE、失业率、非农、GDP、联邦基金利率、M2 |
| `finance_macro_cn` | 中国宏观指标：CPI、PPI、PMI、GDP、货币供应 M0/M1/M2（含同比/环比） |
| `finance_yield_curve` | 美债收益率曲线（含 10Y-2Y 利差） |
| `finance_central_bank` | 央行动态（美联储 / 中国人民银行） |

### 新闻与舆情

| 工具 | 说明 |
| --- | --- |
| `finance_news` | 财经要闻快讯 |
| `finance_stock_news` | 个股新闻 |
| `finance_industry_news` | 行业新闻 |
| `finance_cn_hot` | A股人气榜（东财股吧热度） |
| `finance_hot_list` | A股同花顺热榜（人气值 + 概念标签归因） |
| `finance_sentiment_trending` | 社媒热门股票榜（Reddit/X/Polymarket/新闻） |
| `finance_sentiment_ticker` | 单一美股 ticker 社媒情绪 |
| `finance_sentiment_market` | 美股整体市场情绪 |
| `finance_sentiment_compare` | 多 ticker 情绪对比 |
| `finance_divergence` | 价格 × 社媒情绪背离信号（美股） |

### 预测市场

| 工具 | 说明 |
| --- | --- |
| `finance_prediction_markets` | Polymarket 实钱赔率（政治/宏观/加密热门事件） |
| `finance_kalshi` | Kalshi（CFTC 监管）：Fed 利率、CPI、大选事件合约 |
| `finance_prediction_history` | Polymarket 概率历史曲线 |

## REST API

`/api/*` 是与 MCP 工具平行的 REST 门面，直接复用同一套核心取数函数，方便非 MCP 场景（脚本、前端组件）调用。鉴权方式与 `/mcp` 相同。常用路由：

```
GET /api/search?query=茅台          GET /api/quote?symbol=600519.SH
GET /api/kline?symbol=AAPL          GET /api/metrics?symbol=NVDA
GET /api/financials?symbol=...      GET /api/indicators?symbol=...
GET /api/profile?symbol=...         GET /api/technical?symbol=...
GET /api/macro/us                   GET /api/yield-curve
GET /api/sentiment/ticker           GET /api/polymarket
```

完整路由见 `src/rest*.ts`（约 66 条，基本与工具一一对应）。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `API_TOKEN` | 共享鉴权 token；未设置则开放访问。Workers 用 `wrangler secret put API_TOKEN` 写入 |
| `FRED_API_KEY` | `finance_macro_us` / `finance_economic_calendar` / `finance_yield_curve`（FRED 数据） |
| `ADANOS_API_KEY` | `finance_sentiment_*` / `finance_divergence`（社媒情绪数据） |
| `PORT` | Node 入口监听端口，默认 `3005` |

缺 key 时对应工具返回 503 / 配置错误提示，其余工具不受影响。

## 本地开发

```bash
pnpm install
pnpm dev            # wrangler dev，本地 http://localhost:3005
pnpm test           # vitest（全部上游用 fetchImpl 桩，离线可跑）
pnpm build          # tsdown 打包 Node 入口 → dist/server.mjs
pnpm start          # node dist/server.mjs（Docker 内的启动方式）
pnpm check-types    # tsc --noEmit
```

两个运行入口共享同一个 Hono app（`src/app.ts`）：

- `src/worker.ts` — Cloudflare Workers 入口，env 来自 wrangler bindings；
- `src/server.ts` — Node 入口（Docker），env 注入 `process.env`。

## 数据源与注意事项

| 数据源 | 覆盖 | 说明 |
| --- | --- | --- |
| EastMoney 东方财富 | A股行情、基本面、板块、资金、公告 | JSONP / clist 接口 |
| Tencent 腾讯行情 | K线、实时报价、指数、交易日历 | A股/港股/美股通用 |
| Sina 新浪 | A股 ETF 期权 | T 型报价 + 希腊字母 |
| Yahoo Finance | 美股估值、期权、批量报价、搜索 | 需 cookie+crumb 鉴权，内部自动获取并缓存 30 分钟 |
| SEC EDGAR / XBRL | 美股年度财务数据（10-K）、文件列表 | 审计后年度数据，非季度 |
| Nasdaq | 美股全市场宽度、财报日历 | 宽度为实时快照，不可按历史日期回查 |
| FRED | 美国宏观、收益率曲线 | 需 `FRED_API_KEY` |
| Adanos | 社媒情绪 | 需 `ADANOS_API_KEY` |
| Polymarket / Kalshi | 预测市场 | 公开接口 |
| OpenInsider | 美股内部人交易 | 公开接口 |
| 乐咕乐股 | 指数估值分位 | 公开接口 |

通用行为约定：

- **缓存**：所有工具经 `withCache` 按数据时效缓存（行情 5s～30s、K线 5min、财务 1h、公司资料 24h）。
- **降级**：上游失败时工具返回空结构或 `{ "error": "..." }`，不抛 500；REST 路由对上游错误返回 502。
- **时区**：A股日期为北京时间，美股工具（`finance_us_*`、`finance_m7`）日期为美东时间。
- **美股基本面口径**：`finance_financial_statements` / `finance_financial_indicators` 的美股数据来自 SEC XBRL **年度** 10-K；需要季度或非常用科目时用 `finance_sec_facts`。

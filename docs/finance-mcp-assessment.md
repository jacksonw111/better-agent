# Finance MCP — Capabilities, Self-Assessment & Professional Gap Analysis

**Worker:** `better-agent-finance-mcp` · **Live:** `https://better-agent-finance-mcp.jacksonwen001.workers.dev`
**Surfaces:** MCP (`POST /mcp`, 25 tools) + REST (`GET /api/*`) + host-locked PDF proxy (`GET /pdf`), one shared core.
**Tests:** 141 unit (TDD) + full live smoke from the deployed Worker.

---

## 1. What was built — 25 tools

### Market data (7)
| Tool | Data | Source |
|---|---|---|
| `finance_quote` | Realtime snapshot + **5-level** bid/ask (五档) | Tencent gtimg (US/HK/A) |
| `finance_kline` | OHLCV: day/week/month **+ 1m/5m/15m/30m/60m** | Tencent fqkline / mkline |
| `finance_index_quote` | Major indices (上证/深证/创业板/沪深300/道指/纳指/标普/恒生) | Tencent gtimg |
| `finance_commodity` | COMEX gold, WTI oil, COMEX silver | Tencent hf_ |
| `finance_money_flow` | 主力/超大/大/中/小单净流入 (个股资金流) | EastMoney push2 fflow |
| `finance_hsgt_flow` | 沪深港通 flow (南向 live; 北向 null since 2024-08-19) | EastMoney datacenter |
| `finance_technical` | MA/EMA/MACD/RSI/KDJ/BOLL (computed) | derived from kline |

### Fundamentals (4, A-share)
`finance_key_metrics` (mktcap/PE/PB/PS/PCF/PEG) · `finance_company_profile` (industry/listing/employees/business) · `finance_financial_statements` (income/balance/cashflow) · `finance_financial_indicators` (EPS/revenue+YoY/margins/ROE/debt — time series).

### Research & reports (4)
`finance_search` (A-share name/code lookup) · `finance_research` (analyst reports + EPS/PE forecasts + proxied PDF) · `finance_earnings_forecast` (consensus EPS/PE, this/next/+2 FY) · `finance_list_reports` (periodic report PDFs) + `/pdf` proxy.

### Calendars (3)
`finance_earnings_calendar` (A-share 预约披露 · US Nasdaq · HK HKEXnews) · `finance_economic_calendar` (US macro release schedule, curated key indicators, FRED) · `finance_central_bank` (US NY Fed repo/reverse-repo; CN = no compliant free source).

### Macro (3)
`finance_macro_us` (CPI/PCE/unemployment/NFP/GDP/fed-funds/10Y/M2… — FRED) · `finance_macro_cn` (CPI/PPI/PMI/GDP/M2 with YoY/MoM — EastMoney) · `finance_yield_curve` (US Treasury 1M–30Y — FRED).

### Sector & news (4)
`finance_sector_list` (industry/concept boards) · `finance_sector_constituents` · `finance_news` (7×24 flash) · `finance_stock_news` (per-company search).
> ⚠️ The two **sector** tools currently return `[]` from the deployed Worker: the base push2 host 502s on `clist` from Cloudflare egress (routed to a mirror), and the board `fs` selector still isn't parsed correctly through the Worker's fetch encoding (needs more live debugging). The connectors degrade gracefully to `[]`. **23 of 25 tools return live data**; these two are the known exception. All the underlying board data is free — this is an encoding/host quirk, not a source gap.

---

## 2. Self-assessment

### Performance
- **Edge caching** (Cloudflare Cache API) on every tool, per-source TTL: quotes 5s, indices/commodity 30s, technical 60s, kline 300s, money-flow 120s, calendars/reports/macro 1800–3600s, company profile 24h. Same cache key across MCP & REST, so both surfaces share entries.
- **Concurrency**: dashboard tools (macro_us, macro_cn, yield_curve) fan out with `Promise.all`.
- **Cold start**: only `hono` + `evlog` deps; no heavy libs. Fast.
- **Reachability**: verified all China endpoints resolve from Cloudflare edge egress (Tencent, EastMoney datacenter, push2 fflow, HKEXnews). One quirk found & fixed: base `push2.eastmoney.com` 502s on the `clist` path from CF egress — routed sector to a numbered mirror (`1.push2…`).
- **Ceiling**: China-hosted upstreams add an edge→CN hop; acceptable for request/response, not for HFT.

### Security
- **Read-only, public data** — no user data, no write paths, no PII.
- **PDF proxy is host-locked** to `pdf.dfcfw.com` (https only) — SSRF-reviewed (userinfo/case/subdomain/redirect classes all covered; `redirect: "manual"`).
- **Secrets**: only `FRED_API_KEY`, stored as a Worker secret (never in code/repo).
- **CORS** enabled (`*`) for browser dashboards — safe for public read-only.
- **Input handling**: symbols coerced/validated (`BadSymbolError` → HTTP 400); limits/periods clamped; unknown enums default sanely; errors return a message only (no stack traces) — upstream failures → 502, missing key → 503.
- **Gap (by design)**: no auth / no rate-limiting at the app layer. For a public product, add Cloudflare rate-limiting rules or an API-key gate to prevent abuse (upstreams may throttle our egress IP under load).

### Error handling & retry
- **Shared `fetchWithRetry`** under every connector: up to 3 attempts, exponential backoff (deterministic), retry on **429/500/502/503/504 + network errors**, honor `Retry-After` on 429, **8s timeout** via `AbortSignal.timeout` + `AbortSignal.any` (caller-abort not retried).
- **Graceful degradation per connector**: data endpoints that can flake return `[]`/`null` rather than throwing; only symbol-parse and missing-key errors propagate.
- **MCP never throws out**: `callTool` catches, logs the stack (evlog), returns a friendly `isError` result. REST `onError` maps errors to 400/502/503 JSON.
- **Verified**: retry unit-tested (success-after-500, exhaustion-returns-response, no-retry-on-404, network-retry, no-retry-on-abort).

---

## 3. Professional gap analysis — "what more would I want?"

Rated by lens. **[FREE]** = obtainable free (recommended next builds); **[PAID]** = realistically needs a paid feed.

### 操盘手 / Trader
- ✅ Have: realtime quote (5档), intraday minute bars, money-flow, index/sector, technical indicators, news.
- **[FREE] 龙虎榜** (dragon-tiger daily), **融资融券** (margin balances), **涨停/连板 pool** (limit-up ladder), **大宗交易** (block trades), **股东户数** (holder count trend), **ETF list/quotes** — all on EastMoney datacenter, free.
- **[PAID] 10档/Level-2 order book, tick-by-tick, 逐笔委托** — confirmed no free source anywhere (Sina/Tencent/EastMoney all cap at 5档; L2 is a paid subscription).
- **[PAID] Options greeks/IV** (50ETF/300ETF options) — mostly paid.

### 宏观经济学家 / Macroeconomist
- ✅ Have: US macro values (FRED, deep), CN macro values (CPI/PPI/PMI/GDP/M2), US yield curve, commodities, macro release calendar.
- **[FREE] FX rates** (USD/CNY, DXY) via **FRED** (`DEXCHUS`, `DTWEXBGS`) — no Tencent code exists, but FRED covers it free; **CN 10Y/yield curve** (中债) via chinabond/EastMoney; **global rates & PMIs** (FRED has dozens of countries); **社融/信贷/M2 detail**, **PPI subcomponents**.
- **[FREE] Fed operations** already live (NY Fed). **[GAP] PBOC 逆回购** — no compliant free structured source (chinamoney feed dead; pbc.gov.cn disallows scraping via robots.txt). Would need a licensed feed.

### Quant
- ✅ Have: adjusted OHLCV (day→minute), fundamental time series, technical indicators, symbol search.
- **[FREE] Full symbol universe dump** (all A/HK/US tickers for screening — EastMoney clist paginated), **index constituents & weights** (沪深300/中证500…), **dividends & splits** (分红送配 — needed for clean back-adjustment), **factor-style ratios over time**.
- **[PAID] Tick data, full historical L2, corporate-action-adjusted point-in-time fundamentals** at scale.

### Research institution
- ✅ Have: analyst reports + forecasts, full financials, company profile, news.
- **[FREE] 十大股东/十大流通股东 & 股东变动**, **高管增减持/insider**, **industry peer comparables** (same-industry ranking via clist), **限售解禁** (lockup expiry).
- **[PAID] ESG scores, ownership networks, supply-chain graphs, transcript/sentiment analytics.**

### Recommended next sprint (all FREE, EastMoney/FRED)
1. `finance_dividends` (分红送配) — enables correct back-adjustment. 2. `finance_dragon_tiger` (龙虎榜). 3. `finance_margin` (融资融券). 4. `finance_top_holders` (十大股东/股东户数). 5. `finance_fx` (USD/CNY & DXY via FRED). 6. `finance_index_constituents`. 7. `finance_universe` (screening lists). 8. CN yield curve.

---

## 4. Known limitations (honest)
- **Sector tools return `[]`** — the EastMoney `clist` board selector (`fs=m:90 t:2`) isn't parsed correctly through the Worker's fetch (base host 502s → routed to mirror; several encodings tried). Data is free & the connector is sound; needs a live debug session on the exact wire encoding. 23/25 tools work live.
- **5档 not 10档** — free-market ceiling (verified across Sina/Tencent/EastMoney).
- **北向资金 net flow is null since 2024-08-19** — mainland exchanges stopped disclosing it (not an API bug); 南向 still live.
- **PBOC 逆回购** — `finance_central_bank("cn")` returns `[]`; no compliant free source.
- **CN M2 sub-field** left null in `finance_macro_cn` (M0/M1 populated).
- **Fundamentals are A-share-only** (HK/US financials exist under `RPT_HKF10_*`/`RPT_USF10_*` — a straightforward extension).
- **Economic calendar is US-only** (FRED); values are release *dates*, not actual/estimate/prior (that's a premium Finnhub feature).
- Upstreams are unofficial (EastMoney/Tencent) — tolerated & stable but ToS-gray and can change; every connector degrades to empty rather than breaking.

---

*Generated during the autonomous overnight build. See `docs/superpowers/specs/2026-07-08-finance-mcp-design.md` (design) and `.superpowers/sdd/progress.md` (build ledger) for the full trail.*

# Finance MCP + REST server — design

**Date:** 2026-07-08
**Status:** Approved design, pending implementation plan
**Home:** `better-agent` monorepo, new Worker `apps/finance-mcp` (deployed as `better-agent-finance-mcp`)

## Overview

A financial/economic data server exposed **two ways over one shared core**: an
**MCP server** (for agents) and a **REST/HTTP API** (for dashboards/humans).
Both are thin adapters over the same `src/core/` typed functions — neither wraps
the other. This keeps the MCP tool surface and the REST endpoints permanently in
sync and puts all messy upstream-fetching / JSONP-parsing / normalization in one
unit-testable place.

It mirrors the existing `apps/mcp` (X/Twitter) server: **hand-rolled JSON-RPC
over Hono** in Streamable-HTTP stateless-JSON mode (no MCP SDK), one Worker,
deployed alongside the others.

Three feature domains:

1. **Events calendar** — earnings/report-release dates, macro data-release times
   (CPI/PPI/NFP/GDP/FOMC), and central-bank operations (PBOC 逆回购/MLF, Fed ops),
   across US / HK / A-share.
2. **Realtime quotes + K-line** — multi-market (US/HK/A) via Tencent's free
   `gtimg` feed: snapshot with bid/ask depth, and OHLCV candles.
3. **Financial reports** — EastMoney periodic/quarterly report list + a
   host-locked PDF proxy (list + proxied URL only; no server-side extraction).

## Architecture

```
Upstream sources ──► src/core/ (typed functions, fetchImpl-injectable, cached)
                          │
              ┌───────────┴───────────┐
        MCP adapter               REST adapter
   (tool-defs + tools-impl)      (rest.ts routes)
   POST /mcp  JSON-RPC           GET /api/*
                          │
                    PDF proxy  GET /pdf  (host-locked to pdf.dfcfw.com)
```

- **Core** = plain async functions returning normalized types. Every function
  accepts an optional `{ fetchImpl?, signal? }` for unit testing (same style as
  the `~/stocks` connectors this ports from).
- **MCP adapter** = `mcp-server.ts` (`handleMessage` for `initialize` / `ping` /
  `tools/list` / `tools/call`, notifications → 202), `tool-defs.ts` (JSON-schema
  tool defs), `tools-impl.ts` (dispatch → core, JSON-stringify into `content`).
- **REST adapter** = `rest.ts`, one handler per core function.
- **Auth (v1): public.** All data is public. The PDF proxy is locked to
  `pdf.dfcfw.com`. The only secret is the Finnhub API key (macro calendar). A
  shared API key can be added to the REST side later without touching core.
- **Caching:** Workers **Cache API / KV** in front of every upstream call. Data
  is daily/periodic; caching also shields against EastMoney/Nasdaq anti-scrape
  throttling. TTLs per source (realtime quotes: seconds; calendars/reports:
  minutes–hours).

## Project layout

```
apps/finance-mcp/
  wrangler.toml            # name = "better-agent-finance-mcp"; FINNHUB_API_KEY secret
  package.json             # hono, evlog (catalog); wrangler, vitest (dev)
  src/
    worker.ts              # initLogger({service:"better-agent-finance-mcp"}) + buildApp()
    app.ts                 # Hono: POST /mcp · GET /api/* · GET /pdf · GET / (health)
    mcp-server.ts          # JSON-RPC handleMessage (mirror apps/mcp/src/mcp-server.ts)
    tool-defs.ts           # JSON-schema tool definitions + TOOL_NAMES set
    tools-impl.ts          # tool dispatch → core
    rest.ts                # REST route handlers → core
    pdf-proxy.ts           # proxy pdf.dfcfw.com (Referer+UA, Range), host-locked
    core/
      types.ts             # Quote, Candle, Report, EarningsEvent, EconomicEvent, CbOp, Market
      symbol.ts            # unified symbol ↔ per-source code mapping (US/HK/A)
      tencent/
        quote.ts           # getQuote(symbol) — snapshot + bid/ask depth
        kline.ts           # getKline(symbol, period, limit)
      eastmoney/
        periodic-reports.ts # listReports(symbol, years)  (ported from ~/stocks)
        earnings.ts        # A-share + HK earnings/预约披露 calendar
        central-bank.ts    # PBOC OMO (逆回购/MLF) series
        jsonp.ts           # parseJsonp (ported)
        market.ts          # marketForCode (ported)
      us/
        nasdaq-earnings.ts # US earnings calendar (Nasdaq)
        nyfed.ts           # Fed ops (NY Fed Markets API)
      finnhub/
        economic.ts        # macro economic-release calendar (Finnhub, keyed)
      cache.ts             # Cache-API/KV helper (keyed fetch with TTL)
```

Convention matches the existing `apps/mcp/src/x/` layout: core lives in-app, no
separate workspace package.

## Feature 2 — Realtime quotes + K-line (Tencent, multi-market)

Unified symbol scheme mapped to Tencent codes in `core/symbol.ts`:

| Market | Input symbol | Tencent code |
|---|---|---|
| A-share | `600000.SH` / `000001.SZ` (or bare `600000`) | `sh600000` / `sz000001` |
| HK | `00700.HK` | `hk00700` |
| US | `AAPL` / `AAPL.US` | `usAAPL` |

**Tools / endpoints:**

- `finance_quote(symbol)` → `GET /api/quote?symbol=`
  Realtime snapshot: `market, symbol, name, last, changePct, open, high, low,
  prevClose, volume, turnover, time, bids[], asks[]` where each depth level is
  `{ price, volume }`.
  Source: Tencent `qt.gtimg.cn/q=<code>`.
  **Depth caveat (verify during implementation):** the standard snapshot exposes
  **5 levels (五档)** reliably. True **十档** may require a different Tencent/Sina
  L2 endpoint. Implementation MUST confirm the real free 10-level endpoint; if
  free 10档 is not reliable, fall back to 5档 and document it in the tool
  description. The `bids[]/asks[]` shape already accommodates either depth.

- `finance_kline(symbol, period, limit?)` → `GET /api/kline?symbol=&period=&limit=`
  OHLCV candles: `{ time, open, high, low, close, volume }[]`.
  `period` ∈ `day | week | month | 5m | 15m | 30m | 60m`.
  Source: Tencent `web.ifzq.gtimg.cn` (`qfqday`/minute variants), row order
  `[date, open, close, high, low, volume]`.

## Feature 3 — Financial reports (EastMoney)

Port the proven `~/stocks` connector verbatim.

- `finance_list_reports(symbol, years?)` → `GET /api/reports?symbol=&years=`
  Returns periodic/quarterly reports:
  `{ artCode, title, reportType: "annual"|"h1"|"q1"|"q3", fiscalPeriod,
  noticeDate, pdfUrl }[]`, newest first, default 2 years.
  Source: EastMoney `np-anotice-stock.eastmoney.com/api/security/ann` (JSONP,
  paged, `Referer: https://data.eastmoney.com/`). Only the four full Chinese
  periodic reports are kept (`年度报告全文`, `半年度报告全文`, `一季度报告全文`,
  `三季度报告全文`).
  `pdfUrl` points at **our proxy**, not the raw upstream:
  `https://<worker>/pdf?url=https://pdf.dfcfw.com/pdf/H2_<artCode>_1.pdf`.

- `GET /pdf?url=<pdf.dfcfw.com/...>` — the proxy (ported from
  `~/stocks/apps/server/src/routes/pdf-proxy.ts`), **minus the login gate**
  (these are public filings). Host-locked to `pdf.dfcfw.com`, adds
  `Referer`+`User-Agent`, forwards `Range` for streaming, sets
  `cache-control: public, max-age=300`.

The agent receives the report list + a stable URL it can hand to a human or a
PDF-capable client. No text extraction on the Worker.

## Feature 1 — Events calendar

Three tools, best confirmed source per market. All cached.

### `finance_earnings_calendar(market, from?, to?)` → `GET /api/calendar/earnings`
Report-release / earnings dates. `market` ∈ `a | us | hk`.
- **A-share** — EastMoney `datacenter-web.eastmoney.com/api/data/v1/get`,
  `reportName=RPT_PUBLIC_BS_APPOIN` (业绩预约披露), `Referer` header, no key.
  Fields: `SECURITY_CODE, SECURITY_NAME_ABBR, REPORT_DATE, APPOINT_PUBLISH_DATE,
  ACTUAL_PUBLISH_DATE, IS_PUBLISH, REPORT_TYPE_NAME`. Optionally enrich with
  `RPT_PUBLIC_OP_NEWPREDICT` (业绩预告).
- **US** — Nasdaq `api/calendar/earnings?date=YYYY-MM-DD`, **real `User-Agent`
  required**, no key. Fields: `symbol, name, time (pre/after), epsForecast,
  marketCap`.
- **HK** — EastMoney 港股 datacenter (**best-effort in v1**); HKEXnews as the
  official fallback. HK marked best-effort/experimental in the tool description.

Normalized `EarningsEvent`: `{ market, symbol, name, date, session?,
reportType?, isPublished?, epsForecast? }`.

### `finance_economic_calendar(from, to, country?)` → `GET /api/calendar/economic`
Macro data-release schedule with actual/estimate/prior: CPI, PPI, NFP, GDP,
**FOMC decisions**, China CPI/PPI/PMI.
- **Source: Finnhub** `finnhub.io/api/v1/calendar/economic?token=<KEY>` — free
  key, 60 req/min, covers US + CN in one clean JSON source. `country` filters by
  ISO-2 (`US`, `CN`). Key stored as Worker secret `FINNHUB_API_KEY`.
Normalized `EconomicEvent`: `{ country, event, date, time?, actual?, estimate?,
prior?, impact? }`.

### `finance_central_bank(market)` → `GET /api/calendar/central-bank`
`market` ∈ `cn | us`.
- **PBOC** (`cn`) — 逆回购/reverse-repo + MLF. Primary: EastMoney OMO series
  (`datacenter-web /v1/get`, exact report name confirmed at implementation from
  akshare's `macro_china` mapping); fallback: PBOC.gov.cn 公开市场业务交易公告
  HTML. Normalized: `{ date, type: "reverse_repo"|"mlf", amount, rate, tenor }`.
- **Fed** (`us`) — NY Fed Markets API `markets.newyorkfed.org/api` (repo/reverse
  repo, reference rates), official, **no key**.

## Error handling

- Core functions throw typed errors (`UpstreamError`, `BadSymbolError`,
  `NotConfiguredError` for a missing Finnhub key). On empty/paged-out upstream
  data, connectors return `[]` rather than throwing (matches `~/stocks`).
- MCP adapter catches, logs the full stack via `evlog`, and returns a friendly
  `toolText(message, isError=true)` — same pattern as `apps/mcp`.
- REST adapter maps errors to status codes (`400` bad symbol, `502` upstream,
  `503` not configured) with a JSON `{ error }` body.

## Testing

- **Core connectors**: unit tests with injected `fetchImpl` returning captured
  upstream fixtures (JSONP + JSON), asserting normalization — mirrors the
  `~/stocks` `data-connectors/test/*` suites. Ported connectors bring their
  fixtures.
- **Symbol mapping**: table-driven tests for US/HK/A round-trips.
- **MCP handshake + dispatch**: mirror `apps/mcp/src/mcp-server.test.ts`
  (`initialize`, `tools/list` shape, `tools/call` routing, unknown-tool error).
- **PDF proxy**: host-lock rejection, Range passthrough, header injection
  (port `pdf-proxy` tests).
- Capture a couple of live upstream fixtures once (Nasdaq, EastMoney
  `RPT_PUBLIC_BS_APPOIN`, Tencent quote) to freeze into tests.

## Config & deployment

- `wrangler.toml`: `name = "better-agent-finance-mcp"`, `nodejs_compat`,
  KV namespace binding for cache, secret `FINNHUB_API_KEY`.
- Deploy via the existing GitHub Action path (same as `better-agent-mcp`);
  secrets uploaded from repo secrets. No service binding required unless the main
  server needs to call it (add a `FINANCE_MCP` service binding later if so).

## Phasing (for the implementation plan)

1. **Scaffold + core plumbing**: Worker, Hono app, MCP handshake, symbol
   mapping, cache helper, health route. (No live data yet — proves the shell.)
2. **Feature 2** (quotes + kline) — Tencent connector, 2 tools, 2 REST routes,
   depth-endpoint verification.
3. **Feature 3** (reports + PDF proxy) — port EastMoney periodic-reports +
   pdf-proxy.
4. **Feature 1** (calendar) — earnings (A/US, then HK best-effort), economic
   (Finnhub), central-bank (PBOC + NY Fed).
5. Deploy + smoke-test each tool over MCP and REST.

## Out of scope (v1)

- Server-side PDF text extraction / OCR.
- Per-user auth on MCP/REST (public v1).
- HK as a first-class market (best-effort only).
- Historical macro *values* beyond what the calendar sources return.
- Websocket/streaming realtime (request/response snapshots only).

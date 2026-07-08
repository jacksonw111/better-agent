# Finance MCP + REST Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker that serves financial data (multi-market realtime quotes/K-line, EastMoney report list + PDF proxy, and a US/HK/A events calendar) over both an MCP endpoint and a REST API sharing one core.

**Architecture:** A single Worker (`better-agent-finance-mcp`) mirroring the existing `apps/mcp` pattern: a Hono app exposing `POST /mcp` (hand-rolled JSON-RPC, stateless JSON mode — no MCP SDK), `GET /api/*` (REST), and `GET /pdf` (host-locked proxy). All three call plain typed functions in `src/core/`, each injectable with a `fetchImpl` for tests.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers (`wrangler`), `evlog` logging, `vitest`. Upstream: Tencent `gtimg` (quotes/kline), EastMoney (reports, A-share/HK earnings, PBOC OMO), Nasdaq (US earnings), Finnhub (macro calendar), NY Fed (Fed ops).

## Global Constraints

- Runtime: Cloudflare Workers, `compatibility_date = "2025-09-23"`, `compatibility_flags = ["nodejs_compat"]`.
- Catalog versions (use `catalog:` where the workspace defines them): `hono` (^4.8.2), `evlog` (^2.18.1). Dev deps pinned like `apps/mcp`: `@cloudflare/workers-types` `4.20260625.1`, `wrangler` `4.105.0`, `vitest` `4.1.9`, `typescript` `catalog:`.
- Package name: `finance-mcp`; Worker name: `better-agent-finance-mcp`.
- All core functions accept `opts: { fetchImpl?: typeof fetch; signal?: AbortSignal }` and default `fetchImpl` to global `fetch`. Never call global `fetch` directly inside core logic — always through the injected impl. This is what makes them unit-testable.
- MCP tool names are all prefixed `finance_`. Tool errors return `toolText(message, true)`, never throw out of the handler.
- v1 auth: public. The `/pdf` proxy is host-locked to `pdf.dfcfw.com` only. The only secret is `FINNHUB_API_KEY`.
- Follow `apps/mcp/src` conventions exactly (file naming, `initLogger`, Hono usage). Code must pass `pnpm dlx ultracite check` (Biome): `for...of` not `.forEach`, `const` default, template literals, no `any` (use `unknown`), early returns.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit. Frequent small commits.

---

## File Structure

```
apps/finance-mcp/
  wrangler.toml            # name, compat, KV binding, FINNHUB_API_KEY secret
  package.json             # deps + scripts (dev/test/check-types)
  tsconfig.json            # copy of apps/mcp/tsconfig.json
  src/
    worker.ts              # initLogger + export buildApp()
    app.ts                 # Hono routes: POST /mcp, GET /api/*, GET /pdf, GET /
    mcp-server.ts          # JSON-RPC handleMessage (initialize/ping/tools.list/tools.call)
    tool-defs.ts           # TOOLS array (JSON schema) + TOOL_NAMES set
    tools-impl.ts          # runTool(name,args) → core, returns toolText
    rest.ts                # registerRest(app) — GET /api/* handlers → core
    pdf-proxy.ts           # createPdfProxyHandler — host-locked proxy
    core/
      types.ts             # Market, Quote, DepthLevel, Candle, Report, EarningsEvent, EconomicEvent, CbOp
      symbol.ts            # parseSymbol(input) → { market, code, tencent }
      cache.ts             # withCache(key, ttl, fn) using Cache API
      tencent/
        quote.ts           # parseQuote(text) + getQuote(symbol, opts)
        kline.ts           # parseKline(json, code, period) + getKline(symbol, period, limit, opts)
      eastmoney/
        jsonp.ts           # parseJsonp (ported from ~/stocks)
        market.ts          # marketForCode (ported)
        periodic-reports.ts# listReports(code, opts) (ported)
        earnings.ts        # aShareEarnings(from,to,opts) + hkEarnings(...)
        central-bank.ts    # pbocOps(opts)
      us/
        nasdaq-earnings.ts # usEarnings(date, opts)
        nyfed.ts           # fedOps(opts)
      finnhub/
        economic.ts        # economicCalendar(from,to,country,apiKey,opts)
  __fixtures__/            # captured upstream responses for tests
```

Reference sources to port from (read them before Task 6/8/10):
- `~/stocks/packages/data-connectors/src/eastmoney/periodic-reports.ts`
- `~/stocks/packages/data-connectors/src/eastmoney/jsonp.ts`
- `~/stocks/packages/data-connectors/src/eastmoney/market.ts`
- `~/stocks/apps/server/src/routes/pdf-proxy.ts`

---

## Task 1: Scaffold the Worker

**Files:**
- Create: `apps/finance-mcp/package.json`
- Create: `apps/finance-mcp/tsconfig.json`
- Create: `apps/finance-mcp/wrangler.toml`
- Create: `apps/finance-mcp/src/worker.ts`
- Create: `apps/finance-mcp/src/app.ts`
- Test: `apps/finance-mcp/src/app.test.ts`

**Interfaces:**
- Produces: `buildApp(): Hono` (from `app.ts`), re-exported by `worker.ts` as `default buildApp()`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "finance-mcp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "check-types": "tsc --noEmit",
    "dev": "wrangler dev --port 3005",
    "test": "vitest run"
  },
  "dependencies": {
    "hono": "catalog:",
    "evlog": "catalog:"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "4.20260625.1",
    "typescript": "catalog:",
    "vitest": "4.1.9",
    "wrangler": "4.105.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (identical to `apps/mcp/tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `wrangler.toml`**

```toml
name = "better-agent-finance-mcp"
main = "src/worker.ts"
compatibility_date = "2025-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
NODE_ENV = "production"
```

- [ ] **Step 4: Install deps**

Run: `cd ~/better-agent && pnpm install`
Expected: adds `finance-mcp` to the workspace, no lockfile errors.

- [ ] **Step 5: Write the failing test** — `src/app.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("finance-mcp app", () => {
  it("responds to health check", async () => {
    const app = buildApp();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("better-agent-finance-mcp OK");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm -F finance-mcp test`
Expected: FAIL — cannot resolve `./app`.

- [ ] **Step 7: Create `src/app.ts`**

```ts
import { Hono } from "hono";

export function buildApp(): Hono {
  const app = new Hono();
  app.get("/", (c) => c.text("better-agent-finance-mcp OK"));
  return app;
}
```

- [ ] **Step 8: Create `src/worker.ts`**

```ts
import { initLogger } from "evlog";
import { buildApp } from "./app";

initLogger({ env: { service: "better-agent-finance-mcp" } });

export default buildApp();
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm -F finance-mcp test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/finance-mcp pnpm-lock.yaml
git commit -m "feat(finance-mcp): scaffold worker + health route"
```

---

## Task 2: MCP JSON-RPC core (handshake + empty tool registry)

**Files:**
- Create: `apps/finance-mcp/src/tool-defs.ts`
- Create: `apps/finance-mcp/src/tools-impl.ts`
- Create: `apps/finance-mcp/src/mcp-server.ts`
- Modify: `apps/finance-mcp/src/app.ts`
- Test: `apps/finance-mcp/src/mcp-server.test.ts`

**Interfaces:**
- Produces:
  - `TOOLS: ToolDef[]` and `TOOL_NAMES: Set<string>` (`tool-defs.ts`). `ToolDef = { name: string; description: string; inputSchema: object }`.
  - `runTool(name: string, args: Record<string, unknown>): Promise<{ content: {type:"text";text:string}[]; isError: boolean }>` (`tools-impl.ts`).
  - `handleMessage(message: JsonRpcRequest): Promise<JsonRpcResponse | null>` (`mcp-server.ts`). Returns `null` for notifications.
- Later tasks add entries to `TOOLS` and to the dispatch inside `runTool`.

- [ ] **Step 1: Write the failing test** — `src/mcp-server.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { handleMessage } from "./mcp-server";

describe("mcp handshake", () => {
  it("initialize returns protocol + serverInfo", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(res).not.toBeNull();
    const result = (res as { result: { protocolVersion: string; serverInfo: { name: string } } }).result;
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.serverInfo.name).toBe("better-agent-finance-mcp");
  });

  it("tools/list returns an array", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (res as { result: { tools: unknown[] } }).result.tools;
    expect(Array.isArray(tools)).toBe(true);
  });

  it("notifications return null (no body)", async () => {
    const res = await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res).toBeNull();
  });

  it("unknown tool returns isError", async () => {
    const res = await handleMessage({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "finance_nope", arguments: {} },
    });
    const result = (res as { result: { isError: boolean } }).result;
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F finance-mcp test src/mcp-server.test.ts`
Expected: FAIL — cannot resolve `./mcp-server`.

- [ ] **Step 3: Create `tool-defs.ts`** (empty registry — features append here)

```ts
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Feature tasks push their defs onto this array.
export const TOOLS: ToolDef[] = [];

export const TOOL_NAMES = new Set<string>(TOOLS.map((t) => t.name));
```

- [ ] **Step 4: Create `tools-impl.ts`** (dispatch stub)

```ts
export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError: boolean;
}

export function toolText(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], isError };
}

export function toolJson(value: unknown): ToolResult {
  return toolText(JSON.stringify(value));
}

// Feature tasks add `if (name === "finance_x") { ... }` branches above the fallback.
export function runTool(
  name: string,
  _args: Record<string, unknown>
): Promise<ToolResult> {
  return Promise.resolve(toolText(`Unknown tool: ${name}`, true));
}
```

- [ ] **Step 5: Create `mcp-server.ts`** (mirror `apps/mcp/src/mcp-server.ts` structure)

```ts
import { log } from "evlog";
import { TOOLS } from "./tool-defs";
import { runTool, toolText } from "./tools-impl";

export const PROTOCOL_VERSION = "2025-06-18";
export const SERVER_INFO = { name: "better-agent-finance-mcp", version: "0.1.0" };

interface JsonRpcRequest {
  id?: number | string | null;
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}
interface JsonRpcResponse {
  error?: { code: number; message: string };
  id: number | string | null;
  jsonrpc: "2.0";
  result?: unknown;
}

const METHOD_NOT_FOUND = -32_601;

function ok(id: JsonRpcResponse["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function toArgs(params: Record<string, unknown> | undefined): Record<string, unknown> {
  return typeof params?.arguments === "object" && params.arguments !== null
    ? (params.arguments as Record<string, unknown>)
    : {};
}

async function callTool(
  id: JsonRpcResponse["id"],
  params: Record<string, unknown> | undefined
): Promise<JsonRpcResponse> {
  const name = typeof params?.name === "string" ? params.name : "";
  try {
    return ok(id, await runTool(name, toArgs(params)));
  } catch (err) {
    log.error(
      "finance-mcp",
      `tool ${name} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    );
    const detail = err instanceof Error ? err.message : String(err);
    return ok(id, toolText(`Request failed: ${detail}`, true));
  }
}

export function handleMessage(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  if (message.method.startsWith("notifications/")) {
    return Promise.resolve(null);
  }
  switch (message.method) {
    case "initialize":
      return Promise.resolve(
        ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        })
      );
    case "ping":
      return Promise.resolve(ok(id, {}));
    case "tools/list":
      return Promise.resolve(ok(id, { tools: TOOLS }));
    case "tools/call":
      return callTool(id, message.params);
    default:
      return Promise.resolve({
        jsonrpc: "2.0", id,
        error: { code: METHOD_NOT_FOUND, message: `Unknown method: ${message.method}` },
      });
  }
}
```

- [ ] **Step 6: Wire `POST /mcp` in `app.ts`** (add to `buildApp`, mirror `apps/mcp/src/app.ts`)

```ts
import { Hono } from "hono";
import { handleMessage } from "./mcp-server";

const ACCEPTED = 202;
const BAD_REQUEST = 400;
const PARSE_ERROR = -32_700;

export function buildApp(): Hono {
  const app = new Hono();
  app.get("/", (c) => c.text("better-agent-finance-mcp OK"));

  app.post("/mcp", async (c) => {
    let message: Parameters<typeof handleMessage>[0];
    try {
      message = await c.req.json();
    } catch {
      return c.json(
        { jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error" } },
        BAD_REQUEST
      );
    }
    const response = await handleMessage(message);
    if (response === null) {
      return c.body(null, ACCEPTED);
    }
    return c.json(response);
  });

  return app;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -F finance-mcp test`
Expected: PASS (both `app.test.ts` and `mcp-server.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add apps/finance-mcp/src
git commit -m "feat(finance-mcp): MCP JSON-RPC handshake + empty tool registry"
```

---

## Task 3: Core types + symbol mapping

**Files:**
- Create: `apps/finance-mcp/src/core/types.ts`
- Create: `apps/finance-mcp/src/core/symbol.ts`
- Test: `apps/finance-mcp/src/core/symbol.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `type Market = "a" | "hk" | "us"`; `interface DepthLevel { price: number; volume: number }`; `interface Quote {...}`; `interface Candle {...}`; `interface Report {...}`; `interface EarningsEvent {...}`; `interface EconomicEvent {...}`; `interface CbOp {...}` (full field lists below).
  - `symbol.ts`: `parseSymbol(input: string): { market: Market; code: string; tencent: string }`. Throws `BadSymbolError` on empty/unparseable input.
  - `BadSymbolError extends Error` (define in `symbol.ts`).

- [ ] **Step 1: Create `core/types.ts`**

```ts
export type Market = "a" | "hk" | "us";

export interface DepthLevel {
  price: number;
  volume: number;
}

export interface Quote {
  market: Market;
  symbol: string;
  name: string;
  last: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  changePct: number;
  volume: number;
  time: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ReportType = "annual" | "h1" | "q1" | "q3";

export interface Report {
  artCode: string;
  title: string;
  reportType: ReportType;
  fiscalPeriod: string;
  noticeDate: string;
  pdfUrl: string;
}

export interface EarningsEvent {
  market: Market;
  symbol: string;
  name: string;
  date: string;
  session?: string;
  reportType?: string;
  isPublished?: boolean;
}

export interface EconomicEvent {
  country: string;
  event: string;
  date: string;
  time?: string;
  actual?: string;
  estimate?: string;
  prior?: string;
  impact?: string;
}

export interface CbOp {
  date: string;
  type: string;
  amount?: number;
  rate?: number;
  tenor?: string;
}
```

- [ ] **Step 2: Write the failing test** — `core/symbol.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { BadSymbolError, parseSymbol } from "./symbol";

describe("parseSymbol", () => {
  it.each([
    ["600000.SH", "a", "600000", "sh600000"],
    ["000001.SZ", "a", "000001", "sz000001"],
    ["600000", "a", "600000", "sh600000"],
    ["000001", "a", "000001", "sz000001"],
    ["688981", "a", "688981", "sh688981"],
    ["00700.HK", "hk", "00700", "hk00700"],
    ["700.HK", "hk", "00700", "hk00700"],
    ["AAPL", "us", "AAPL", "usAAPL"],
    ["aapl.us", "us", "AAPL", "usAAPL"],
  ])("maps %s", (input, market, code, tencent) => {
    expect(parseSymbol(input)).toEqual({ market, code, tencent });
  });

  it("throws on empty", () => {
    expect(() => parseSymbol("")).toThrow(BadSymbolError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F finance-mcp test src/core/symbol.test.ts`
Expected: FAIL — cannot resolve `./symbol`.

- [ ] **Step 4: Create `core/symbol.ts`**

```ts
import type { Market } from "./types";

export class BadSymbolError extends Error {}

const SUFFIX_RE = /\.(SH|SZ|HK|US)$/i;
const SH_A_PREFIX = /^(5|6|9)/; // Shanghai A-share / STAR code ranges
const ALL_DIGITS = /^\d+$/;

export function parseSymbol(input: string): { market: Market; code: string; tencent: string } {
  const raw = input.trim();
  if (!raw) {
    throw new BadSymbolError("empty symbol");
  }
  const suffixMatch = raw.match(SUFFIX_RE);
  const suffix = suffixMatch?.[1]?.toUpperCase();
  const body = raw.replace(SUFFIX_RE, "");

  if (suffix === "SH") {
    return { market: "a", code: body, tencent: `sh${body}` };
  }
  if (suffix === "SZ") {
    return { market: "a", code: body, tencent: `sz${body}` };
  }
  if (suffix === "HK") {
    const code = body.padStart(5, "0");
    return { market: "hk", code, tencent: `hk${code}` };
  }
  if (suffix === "US") {
    const code = body.toUpperCase();
    return { market: "us", code, tencent: `us${code}` };
  }
  // No suffix: infer from shape.
  if (ALL_DIGITS.test(body)) {
    if (body.length === 6) {
      const t = SH_A_PREFIX.test(body) ? `sh${body}` : `sz${body}`;
      return { market: "a", code: body, tencent: t };
    }
    const code = body.padStart(5, "0");
    return { market: "hk", code, tencent: `hk${code}` };
  }
  const code = body.toUpperCase();
  return { market: "us", code, tencent: `us${code}` };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F finance-mcp test src/core/symbol.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/finance-mcp/src/core/types.ts apps/finance-mcp/src/core/symbol.ts apps/finance-mcp/src/core/symbol.test.ts
git commit -m "feat(finance-mcp): core types + multi-market symbol mapping"
```

---

## Task 4: Tencent realtime quote + `finance_quote` tool + REST

**Files:**
- Create: `apps/finance-mcp/src/core/tencent/quote.ts`
- Create: `apps/finance-mcp/src/core/tencent/quote.test.ts`
- Create: `apps/finance-mcp/src/rest.ts`
- Modify: `apps/finance-mcp/src/tool-defs.ts`, `apps/finance-mcp/src/tools-impl.ts`, `apps/finance-mcp/src/app.ts`

**Interfaces:**
- Consumes: `parseSymbol` (Task 3), `Quote`/`DepthLevel` (Task 3), `toolJson`/`toolText` (Task 2).
- Produces:
  - `parseQuote(text: string, market: Market, symbol: string): Quote` (pure).
  - `getQuote(symbol: string, opts?): Promise<Quote>` — fetches GBK bytes, decodes, calls `parseQuote`.
  - `registerRest(app: Hono): void` (`rest.ts`) — this task adds `GET /api/quote`.

The Tencent snapshot is GBK, `~`-delimited, wrapped as `v_<code>="...";`. Field indices (verified live): `1`=name, `2`=code, `3`=last, `4`=prevClose, `5`=open, `6`=volume(手), `9..18`=five bid levels (price,vol ×5), `19..28`=five ask levels, `30`=datetime, `31`=change, `32`=changePct, `33`=high, `34`=low. US/HK zero-fill depth beyond level 1 — drop levels whose price is 0.

- [ ] **Step 1: Write the failing test** — `core/tencent/quote.test.ts` (fixture is already-decoded text, so the test never touches GBK)

```ts
import { describe, expect, it } from "vitest";
import { getQuote, parseQuote } from "./quote";

const SH = `v_sh600000="1~浦发银行~600000~9.00~8.89~8.85~544687~323481~221557~9.00~1384~8.99~2223~8.98~911~8.97~602~8.96~374~9.01~655~9.02~17648~9.03~10161~9.04~6039~9.05~10338~~20260708161454~0.11~1.24~9.03~8.79~9.00/544687/488055514~";`;

describe("parseQuote", () => {
  it("parses A-share snapshot with 5-level depth", () => {
    const q = parseQuote(SH, "a", "600000.SH");
    expect(q.name).toBe("浦发银行");
    expect(q.last).toBe(9.0);
    expect(q.prevClose).toBe(8.89);
    expect(q.open).toBe(8.85);
    expect(q.high).toBe(9.03);
    expect(q.low).toBe(8.79);
    expect(q.changePct).toBe(1.24);
    expect(q.bids).toHaveLength(5);
    expect(q.bids[0]).toEqual({ price: 9.0, volume: 1384 });
    expect(q.asks[0]).toEqual({ price: 9.01, volume: 655 });
    expect(q.time).toBe("20260708161454");
  });

  it("drops zero-priced depth levels (US)", () => {
    const US = `v_usAAPL="200~苹果~AAPL.OQ~310.66~312.66~315.29~42490002~0~0~311.40~40~0~0~0~0~0~0~0~0~312.04~40~0~0~0~0~0~0~0~0~~2026-07-07 16:00:01~-2.00~-0.64~315.48~310.15~USD~";`;
    const q = parseQuote(US, "us", "AAPL");
    expect(q.bids).toHaveLength(1);
    expect(q.asks).toHaveLength(1);
    expect(q.last).toBe(310.66);
  });

  it("getQuote fetches and decodes", async () => {
    const fetchImpl = async () =>
      new Response(new TextEncoder().encode(SH.replace("v_sh600000", "v_sh600000")));
    const q = await getQuote("600000.SH", { fetchImpl: fetchImpl as typeof fetch });
    expect(q.name).toBe("浦发银行");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F finance-mcp test src/core/tencent/quote.test.ts`
Expected: FAIL — cannot resolve `./quote`.

- [ ] **Step 3: Create `core/tencent/quote.ts`**

```ts
import { parseSymbol } from "../symbol";
import type { DepthLevel, Market, Quote } from "../types";

const QUOTE_HOST = "https://qt.gtimg.cn/q=";

function num(fields: string[], i: number): number {
  const n = Number(fields[i]);
  return Number.isFinite(n) ? n : 0;
}

function depth(fields: string[], start: number): DepthLevel[] {
  const levels: DepthLevel[] = [];
  for (let i = 0; i < 5; i++) {
    const price = num(fields, start + i * 2);
    const volume = num(fields, start + i * 2 + 1);
    if (price > 0) {
      levels.push({ price, volume });
    }
  }
  return levels;
}

export function parseQuote(text: string, market: Market, symbol: string): Quote {
  const payload = text.split('"')[1] ?? "";
  const fields = payload.split("~");
  return {
    market,
    symbol,
    name: fields[1] ?? "",
    last: num(fields, 3),
    prevClose: num(fields, 4),
    open: num(fields, 5),
    volume: num(fields, 6),
    bids: depth(fields, 9),
    asks: depth(fields, 19),
    time: fields[30] ?? "",
    changePct: num(fields, 32),
    high: num(fields, 33),
    low: num(fields, 34),
  };
}

export async function getQuote(
  symbol: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<Quote> {
  const doFetch = opts.fetchImpl ?? fetch;
  const { market, tencent } = parseSymbol(symbol);
  const res = await doFetch(`${QUOTE_HOST}${tencent}`, {
    headers: { Referer: "https://gu.qq.com/" },
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`tencent quote HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  const text = new TextDecoder("gbk").decode(buf);
  return parseQuote(text, market, symbol);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F finance-mcp test src/core/tencent/quote.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify `TextDecoder('gbk')` works on the Worker runtime**

Run: `cd apps/finance-mcp && pnpm dev` then in another shell:
`curl -s "http://localhost:3005/api/quote?symbol=600000.SH"` (after Step 7 wires the route) — but for now add a temporary route or run a one-off. Minimum check: `pnpm -F finance-mcp exec wrangler dev` boots without error and `new TextDecoder('gbk')` does not throw.
Expected: Chinese `name` decodes correctly (`浦发银行`). If `TextDecoder('gbk')` throws `RangeError` on this runtime, STOP and switch `getQuote` to decode via a bundled `gbk` decoder (add `gpt`-free pure-JS pkg `gbk` / `iconv-lite` to deps and `iconv.decode(Buffer.from(buf), 'gbk')`); re-run tests. Record the outcome in the commit message.

- [ ] **Step 6: Add the tool def** — append to `TOOLS` in `tool-defs.ts`

```ts
TOOLS.push({
  name: "finance_quote",
  description:
    "Realtime market quote snapshot for a US, HK, or A-share symbol. Returns last " +
    "price, change %, OHLC, volume, and up to 5 levels of bid/ask depth (五档; US/HK " +
    "expose only level 1). Symbol formats: 600000.SH, 000001.SZ, 00700.HK, AAPL.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Ticker, e.g. 600000.SH / 00700.HK / AAPL." },
    },
    required: ["symbol"],
    additionalProperties: false,
  },
});
TOOL_NAMES.add("finance_quote");
```

Note: change `TOOL_NAMES` from a value computed once to a mutable `Set` populated as defs are pushed. Ensure `tool-defs.ts` declares `export const TOOL_NAMES = new Set<string>();` and each push adds its name. Update Task 2's file accordingly if not already mutable.

- [ ] **Step 7: Add dispatch + REST route**

In `tools-impl.ts`, import `getQuote` and add before the fallback:

```ts
if (name === "finance_quote") {
  const symbol = typeof _args.symbol === "string" ? _args.symbol : "";
  return toolJson(await getQuote(symbol));
}
```

Create `rest.ts`:

```ts
import type { Hono } from "hono";
import { getQuote } from "./core/tencent/quote";

export function registerRest(app: Hono): void {
  app.get("/api/quote", async (c) => {
    const symbol = c.req.query("symbol") ?? "";
    return c.json(await getQuote(symbol));
  });
}
```

Wire it in `app.ts`: `import { registerRest } from "./rest";` then `registerRest(app);` inside `buildApp` before `return app;`.

- [ ] **Step 8: Add a REST integration test** — append to `src/app.test.ts`

```ts
it("GET /api/quote returns a parsed quote", async () => {
  const app = buildApp();
  // rest.ts uses the real getQuote which calls global fetch; stub it.
  const SH = 'v_sh600000="1~浦发银行~600000~9.00~8.89~8.85~544687~323481~221557~9.00~1384~8.99~2223~8.98~911~8.97~602~8.96~374~9.01~655~9.02~17648~9.03~10161~9.04~6039~9.05~10338~~20260708161454~0.11~1.24~9.03~8.79~~";';
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new TextEncoder().encode(SH))) as typeof fetch;
  try {
    const res = await app.request("/api/quote?symbol=600000.SH");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("浦发银行");
  } finally {
    globalThis.fetch = orig;
  }
});
```

- [ ] **Step 9: Run the full suite**

Run: `pnpm -F finance-mcp test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/finance-mcp/src
git commit -m "feat(finance-mcp): tencent realtime quote — finance_quote tool + REST"
```

---

## Task 5: Tencent K-line + `finance_kline` tool + REST

**Files:**
- Create: `apps/finance-mcp/src/core/tencent/kline.ts`
- Create: `apps/finance-mcp/src/core/tencent/kline.test.ts`
- Modify: `tool-defs.ts`, `tools-impl.ts`, `rest.ts`

**Interfaces:**
- Consumes: `parseSymbol`, `Candle`.
- Produces:
  - `type KlinePeriod = "day" | "week" | "month"`.
  - `parseKline(json: unknown, tencentCode: string, period: KlinePeriod): Candle[]` (pure).
  - `getKline(symbol, period, limit, opts?): Promise<Candle[]>`.

Endpoint (verified): `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=<tencentCode>,<period>,,,<limit>,qfq` → `{ code:0, data:{ <tencentCode>:{ qfq<period>: [[date,open,close,high,low,volume], ...] } } }`. Row order is `[date, open, close, high, low, volume]` (note: close before high/low). v1 supports day/week/month only; minute klines are deferred (different endpoint).

- [ ] **Step 1: Write the failing test** — `core/tencent/kline.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { getKline, parseKline } from "./kline";

const RAW = {
  code: 0,
  data: {
    sh600000: {
      qfqday: [
        ["2026-06-24", "9.260", "8.900", "9.270", "8.900", "1075266.000"],
        ["2026-06-25", "8.850", "8.850", "8.930", "8.820", "658297.000"],
      ],
    },
  },
};

describe("parseKline", () => {
  it("maps rows to candles with close before high/low", () => {
    const candles = parseKline(RAW, "sh600000", "day");
    expect(candles).toHaveLength(2);
    expect(candles[0]).toEqual({
      time: "2026-06-24", open: 9.26, close: 8.9, high: 9.27, low: 8.9, volume: 1075266,
    });
  });

  it("getKline fetches and parses", async () => {
    const fetchImpl = async () => new Response(JSON.stringify(RAW));
    const candles = await getKline("600000.SH", "day", 10, { fetchImpl: fetchImpl as typeof fetch });
    expect(candles[1]?.time).toBe("2026-06-25");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F finance-mcp test src/core/tencent/kline.test.ts`
Expected: FAIL — cannot resolve `./kline`.

- [ ] **Step 3: Create `core/tencent/kline.ts`**

```ts
import { parseSymbol } from "../symbol";
import type { Candle } from "../types";

export type KlinePeriod = "day" | "week" | "month";

const KLINE_HOST = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Row: [date, open, close, high, low, volume]
function rowToCandle(row: unknown[]): Candle | null {
  if (row.length < 6) {
    return null;
  }
  const time = String(row[0] ?? "");
  if (!time) {
    return null;
  }
  return {
    time,
    open: num(row[1]),
    close: num(row[2]),
    high: num(row[3]),
    low: num(row[4]),
    volume: num(row[5]),
  };
}

export function parseKline(json: unknown, tencentCode: string, period: KlinePeriod): Candle[] {
  const data = (json as { data?: Record<string, Record<string, unknown>> }).data;
  const node = data?.[tencentCode];
  const rows = node?.[`qfq${period}`] ?? node?.[period];
  if (!Array.isArray(rows)) {
    return [];
  }
  const candles: Candle[] = [];
  for (const row of rows as unknown[][]) {
    const candle = rowToCandle(row);
    if (candle) {
      candles.push(candle);
    }
  }
  return candles;
}

export async function getKline(
  symbol: string,
  period: KlinePeriod,
  limit: number,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<Candle[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const { tencent } = parseSymbol(symbol);
  const url = `${KLINE_HOST}?param=${tencent},${period},,,${limit},qfq`;
  const res = await doFetch(url, { signal: opts.signal });
  if (!res.ok) {
    throw new Error(`tencent kline HTTP ${res.status}`);
  }
  return parseKline(await res.json(), tencent, period);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F finance-mcp test src/core/tencent/kline.test.ts`
Expected: PASS.

- [ ] **Step 5: Add tool def** — append to `tool-defs.ts`

```ts
TOOLS.push({
  name: "finance_kline",
  description:
    "Historical OHLCV candles for a US/HK/A-share symbol. period is day, week, or " +
    "month; limit caps the number of most-recent candles (default 240).",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Ticker, e.g. 600000.SH / 00700.HK / AAPL." },
      period: { type: "string", enum: ["day", "week", "month"], description: "Candle period. Default day." },
      limit: { type: "number", description: "Max candles (default 240)." },
    },
    required: ["symbol"],
    additionalProperties: false,
  },
});
TOOL_NAMES.add("finance_kline");
```

- [ ] **Step 6: Add dispatch + REST route**

`tools-impl.ts` (before fallback):

```ts
if (name === "finance_kline") {
  const symbol = typeof _args.symbol === "string" ? _args.symbol : "";
  const period = _args.period === "week" || _args.period === "month" ? _args.period : "day";
  const limit = typeof _args.limit === "number" ? _args.limit : 240;
  return toolJson(await getKline(symbol, period, limit));
}
```

`rest.ts` (inside `registerRest`):

```ts
app.get("/api/kline", async (c) => {
  const symbol = c.req.query("symbol") ?? "";
  const p = c.req.query("period");
  const period = p === "week" || p === "month" ? p : "day";
  const limit = Number(c.req.query("limit") ?? "240") || 240;
  return c.json(await getKline(symbol, period, limit));
});
```

Add imports: `import { getKline } from "./core/tencent/kline";` in both files.

- [ ] **Step 7: Run full suite**

Run: `pnpm -F finance-mcp test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/finance-mcp/src
git commit -m "feat(finance-mcp): tencent kline — finance_kline tool + REST"
```

---

## Task 6: EastMoney periodic reports + `finance_list_reports` tool + REST

**Files:**
- Create: `apps/finance-mcp/src/core/eastmoney/jsonp.ts` (port)
- Create: `apps/finance-mcp/src/core/eastmoney/periodic-reports.ts` (port, with pdfUrl change)
- Create: `apps/finance-mcp/src/core/eastmoney/periodic-reports.test.ts`
- Modify: `tool-defs.ts`, `tools-impl.ts`, `rest.ts`

**Interfaces:**
- Consumes: `parseSymbol` (for the 6-digit A-share code), `Report`/`ReportType`.
- Produces: `listReports(symbol: string, years: number, opts?): Promise<Report[]>`. The `pdfUrl` is a RELATIVE proxy path `/pdf?url=<encoded upstream>` (absolute origin is prepended by the REST/tool layer if desired; keep relative in core).

Port `~/stocks/packages/data-connectors/src/eastmoney/{jsonp.ts,periodic-reports.ts}` verbatim EXCEPT: `listPeriodicReports(code, ...)` becomes `listReports(symbol, years, opts)` — call `parseSymbol(symbol).code` to get the 6-digit code, and change `toReport`'s `pdfUrl` from the raw `pdf.dfcfw.com` URL to the proxy path:

```ts
const upstream = `https://pdf.dfcfw.com/pdf/H2_${r.art_code}_1.pdf`;
// ...
pdfUrl: `/pdf?url=${encodeURIComponent(upstream)}`,
```

- [ ] **Step 1: Read the reference implementation**

Run: `cat ~/stocks/packages/data-connectors/src/eastmoney/jsonp.ts ~/stocks/packages/data-connectors/src/eastmoney/periodic-reports.ts`
This is the exact logic to port (paging over `np-anotice-stock.eastmoney.com/api/security/ann`, `NAME_TO_TYPE` map, cutoff-by-years).

- [ ] **Step 2: Write the failing test** — `core/eastmoney/periodic-reports.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { listReports } from "./periodic-reports";

function jsonpResponse(list: unknown[]): Response {
  return new Response(`jsonp(${JSON.stringify({ data: { list } })})`);
}

describe("listReports", () => {
  it("keeps only the four full periodic reports and builds a proxied pdfUrl", async () => {
    const list = [
      {
        art_code: "AN202607081", notice_date: "2026-07-01 00:00:00", title_ch: "2026年半年度报告",
        columns: [{ column_name: "半年度报告全文" }],
      },
      {
        art_code: "AN202607082", notice_date: "2026-07-02 00:00:00", title_ch: "投资者关系活动记录表",
        columns: [{ column_name: "其他" }],
      },
    ];
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls === 1 ? jsonpResponse(list) : jsonpResponse([]);
    };
    const reports = await listReports("600000.SH", 2, {
      fetchImpl: fetchImpl as typeof fetch,
      now: Date.parse("2026-07-08"),
    });
    expect(reports).toHaveLength(1);
    expect(reports[0]?.reportType).toBe("h1");
    expect(reports[0]?.pdfUrl).toBe(
      `/pdf?url=${encodeURIComponent("https://pdf.dfcfw.com/pdf/H2_AN202607081_1.pdf")}`
    );
  });
});
```

Note: `listReports` must accept `now` in `opts` (port keeps this) for deterministic cutoff.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F finance-mcp test src/core/eastmoney/periodic-reports.test.ts`
Expected: FAIL — cannot resolve `./periodic-reports`.

- [ ] **Step 4: Create `jsonp.ts`** (port verbatim from `~/stocks`)

```ts
// Parse a JSONP body: `callback({...})` → the inner JSON object.
export function parseJsonp<T>(body: string): T {
  const start = body.indexOf("(");
  const end = body.lastIndexOf(")");
  if (start === -1 || end === -1 || end <= start) {
    return {} as T;
  }
  return JSON.parse(body.slice(start + 1, end)) as T;
}
```

- [ ] **Step 5: Create `periodic-reports.ts`** — port the `~/stocks` file, renaming the entry to `listReports(symbol, years, opts)`, calling `parseSymbol(symbol).code`, and using the proxied `pdfUrl` shown above. Keep `opts.now`, `opts.fetchImpl`, `opts.signal`, the `MAX_PAGES`/`PAGE_SIZE` paging, and the `NAME_TO_TYPE` map unchanged.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -F finance-mcp test src/core/eastmoney/periodic-reports.test.ts`
Expected: PASS.

- [ ] **Step 7: Add tool def + dispatch + REST**

`tool-defs.ts`:

```ts
TOOLS.push({
  name: "finance_list_reports",
  description:
    "List an A-share company's periodic financial reports (annual / H1 / Q1 / Q3) from " +
    "EastMoney, newest first. Each item includes artCode, title, reportType, noticeDate, " +
    "and pdfUrl (a proxied link to the full PDF).",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "A-share ticker, e.g. 600000.SH." },
      years: { type: "number", description: "Look-back window in years (default 2)." },
    },
    required: ["symbol"],
    additionalProperties: false,
  },
});
TOOL_NAMES.add("finance_list_reports");
```

`tools-impl.ts` (before fallback):

```ts
if (name === "finance_list_reports") {
  const symbol = typeof _args.symbol === "string" ? _args.symbol : "";
  const years = typeof _args.years === "number" ? _args.years : 2;
  return toolJson(await listReports(symbol, years));
}
```

`rest.ts`:

```ts
app.get("/api/reports", async (c) => {
  const symbol = c.req.query("symbol") ?? "";
  const years = Number(c.req.query("years") ?? "2") || 2;
  return c.json(await listReports(symbol, years));
});
```

Add `import { listReports } from "./core/eastmoney/periodic-reports";` in both.

- [ ] **Step 8: Run full suite + commit**

Run: `pnpm -F finance-mcp test`
Expected: PASS.

```bash
git add apps/finance-mcp/src
git commit -m "feat(finance-mcp): eastmoney periodic reports — finance_list_reports tool + REST"
```

---

## Task 7: PDF proxy (`GET /pdf`)

**Files:**
- Create: `apps/finance-mcp/src/pdf-proxy.ts` (port from `~/stocks`, minus session gate)
- Create: `apps/finance-mcp/src/pdf-proxy.test.ts`
- Modify: `apps/finance-mcp/src/app.ts`

**Interfaces:**
- Produces: `createPdfProxyHandler(fetchImpl: typeof fetch): (c: Context) => Promise<Response>`. Host-locked to `pdf.dfcfw.com`. Forwards `Range`; sets `cache-control: public, max-age=300`.

- [ ] **Step 1: Read the reference**

Run: `cat ~/stocks/apps/server/src/routes/pdf-proxy.ts`
Port `validateUrl`, `buildUpstreamHeaders`, `buildResponseHeaders` verbatim. REMOVE the `resolveSession`/`WEB_SESSION_COOKIE` auth entirely (public filings).

- [ ] **Step 2: Write the failing test** — `pdf-proxy.test.ts`

```ts
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createPdfProxyHandler } from "./pdf-proxy";

function appWith(fetchImpl: typeof fetch): Hono {
  const app = new Hono();
  app.get("/pdf", createPdfProxyHandler(fetchImpl));
  return app;
}

describe("pdf proxy", () => {
  it("rejects a non-allowed host", async () => {
    const app = appWith((async () => new Response("nope")) as typeof fetch);
    const res = await app.request("/pdf?url=https://evil.com/x.pdf");
    expect(res.status).toBe(400);
  });

  it("proxies an allowed pdf.dfcfw.com url and sets cache-control", async () => {
    const captured: { url?: string; referer?: string } = {};
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      captured.url = url;
      captured.referer = new Headers(init?.headers).get("Referer") ?? undefined;
      return new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } });
    }) as typeof fetch;
    const app = appWith(fetchImpl);
    const res = await app.request("/pdf?url=https://pdf.dfcfw.com/pdf/H2_ABC_1.pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(captured.referer).toBe("https://data.eastmoney.com/");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F finance-mcp test src/pdf-proxy.test.ts`
Expected: FAIL — cannot resolve `./pdf-proxy`.

- [ ] **Step 4: Create `pdf-proxy.ts`** — port the reference with this signature (no session):

```ts
import type { Context } from "hono";

const ALLOWED_HOST = "pdf.dfcfw.com";
const UPSTREAM_REFERER = "https://data.eastmoney.com/";
const UPSTREAM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PROXY_HEADERS = [
  "content-type", "content-length", "content-range",
  "accept-ranges", "last-modified", "etag",
] as const;
const CACHE_CONTROL = "public, max-age=300";
const DEFAULT_CONTENT_TYPE = "application/pdf";

function validateUrl(raw: string | undefined): URL | null {
  if (!raw) {
    return null;
  }
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" || target.host !== ALLOWED_HOST) {
    return null;
  }
  return target;
}

function buildUpstreamHeaders(range: string | undefined): Headers {
  const headers = new Headers({ Referer: UPSTREAM_REFERER, "User-Agent": UPSTREAM_UA });
  if (range) {
    headers.set("Range", range);
  }
  return headers;
}

function buildResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const h of PROXY_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) {
      headers.set(h, v);
    }
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", DEFAULT_CONTENT_TYPE);
  }
  headers.set("cache-control", CACHE_CONTROL);
  return headers;
}

export function createPdfProxyHandler(fetchImpl: typeof fetch) {
  return async (c: Context): Promise<Response> => {
    const target = validateUrl(c.req.query("url"));
    if (!target) {
      return c.text("forbidden host", 400);
    }
    const upstream = await fetchImpl(target.toString(), {
      headers: buildUpstreamHeaders(c.req.header("range")),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: buildResponseHeaders(upstream),
    });
  };
}
```

- [ ] **Step 5: Wire into `app.ts`**

```ts
import { createPdfProxyHandler } from "./pdf-proxy";
// inside buildApp, before return:
app.get("/pdf", createPdfProxyHandler(fetch));
```

- [ ] **Step 6: Run full suite + commit**

Run: `pnpm -F finance-mcp test`
Expected: PASS.

```bash
git add apps/finance-mcp/src
git commit -m "feat(finance-mcp): host-locked pdf.dfcfw.com proxy (GET /pdf)"
```

---

## Task 8: Earnings calendar (A-share + US, HK best-effort) + tool + REST

**Files:**
- Create: `apps/finance-mcp/src/core/eastmoney/earnings.ts`
- Create: `apps/finance-mcp/src/core/us/nasdaq-earnings.ts`
- Create: `apps/finance-mcp/src/core/eastmoney/earnings.test.ts`
- Create: `apps/finance-mcp/src/core/us/nasdaq-earnings.test.ts`
- Modify: `tool-defs.ts`, `tools-impl.ts`, `rest.ts`

**Interfaces:**
- Consumes: `EarningsEvent`.
- Produces:
  - `aShareEarnings(reportDate: string, opts?): Promise<EarningsEvent[]>` — EastMoney `RPT_PUBLIC_BS_APPOIN`, filtered by fiscal `REPORT_DATE` (e.g. `2026-06-30`).
  - `usEarnings(date: string, opts?): Promise<EarningsEvent[]>` — Nasdaq `api/calendar/earnings?date=YYYY-MM-DD`.
  - `earningsCalendar(market, date, opts?): Promise<EarningsEvent[]>` dispatcher in `earnings.ts` (imports `usEarnings`). HK returns `[]` in v1 (best-effort placeholder, documented in the tool).

EastMoney URL: `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_PUBLIC_BS_APPOIN&columns=ALL&pageSize=50&pageNumber=1&sortColumns=FIRST_APPOINT_DATE&sortTypes=1&filter=(REPORT_DATE='<date>')`, header `Referer: https://data.eastmoney.com/`. Response: `{ result: { data: [ { SECURITY_CODE, SECURITY_NAME_ABBR, APPOINT_PUBLISH_DATE, ACTUAL_PUBLISH_DATE, IS_PUBLISH, REPORT_TYPE_NAME } ] } }`.
Nasdaq: header `User-Agent: Mozilla/5.0 ...` + `Accept: application/json`; response `{ data: { rows: [ { symbol, name, time, epsForecast } ] } }`; `time` like `time-pre-market` / `time-after-hours`.

- [ ] **Step 1: Write the failing test** — `core/us/nasdaq-earnings.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { usEarnings } from "./nasdaq-earnings";

describe("usEarnings", () => {
  it("normalizes Nasdaq rows", async () => {
    const payload = { data: { rows: [
      { symbol: "PEP", name: "PepsiCo", time: "time-pre-market", epsForecast: "$2.00" },
    ] } };
    const fetchImpl = async () => new Response(JSON.stringify(payload));
    const events = await usEarnings("2026-07-09", { fetchImpl: fetchImpl as typeof fetch });
    expect(events[0]).toMatchObject({ market: "us", symbol: "PEP", name: "PepsiCo", date: "2026-07-09", session: "pre-market" });
  });

  it("returns [] when Nasdaq has no rows", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ data: null }));
    expect(await usEarnings("2026-07-09", { fetchImpl: fetchImpl as typeof fetch })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run + fail**

Run: `pnpm -F finance-mcp test src/core/us/nasdaq-earnings.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Create `core/us/nasdaq-earnings.ts`**

```ts
import type { EarningsEvent } from "../types";

const NASDAQ_URL = "https://api.nasdaq.com/api/calendar/earnings";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface NasdaqRow { symbol?: string; name?: string; time?: string; epsForecast?: string }

function session(time: string | undefined): string | undefined {
  if (time?.includes("pre-market")) {
    return "pre-market";
  }
  if (time?.includes("after-hours")) {
    return "after-hours";
  }
  return undefined;
}

export async function usEarnings(
  date: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<EarningsEvent[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${NASDAQ_URL}?date=${date}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`nasdaq HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: { rows?: NasdaqRow[] } | null };
  const rows = json.data?.rows ?? [];
  return rows
    .filter((r): r is NasdaqRow & { symbol: string } => Boolean(r.symbol))
    .map((r) => ({
      market: "us" as const, symbol: r.symbol, name: r.name ?? "",
      date, session: session(r.time),
    }));
}
```

- [ ] **Step 4: Run + pass**

Run: `pnpm -F finance-mcp test src/core/us/nasdaq-earnings.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test** — `core/eastmoney/earnings.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { aShareEarnings, earningsCalendar } from "./earnings";

describe("aShareEarnings", () => {
  it("normalizes RPT_PUBLIC_BS_APPOIN rows", async () => {
    const payload = { result: { data: [
      { SECURITY_CODE: "600000", SECURITY_NAME_ABBR: "浦发银行", APPOINT_PUBLISH_DATE: "2026-08-28 00:00:00", ACTUAL_PUBLISH_DATE: null, IS_PUBLISH: "否", REPORT_TYPE_NAME: "2026年 半年报" },
    ] }, success: true };
    const fetchImpl = async () => new Response(JSON.stringify(payload));
    const events = await aShareEarnings("2026-06-30", { fetchImpl: fetchImpl as typeof fetch });
    expect(events[0]).toMatchObject({ market: "a", symbol: "600000", name: "浦发银行", date: "2026-08-28", isPublished: false, reportType: "2026年 半年报" });
  });
});

describe("earningsCalendar dispatch", () => {
  it("HK is best-effort and returns []", async () => {
    expect(await earningsCalendar("hk", "2026-06-30")).toEqual([]);
  });
});
```

- [ ] **Step 6: Run + fail**, then **Step 7: Create `core/eastmoney/earnings.ts`**

```ts
import { usEarnings } from "../us/nasdaq-earnings";
import type { EarningsEvent, Market } from "../types";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";

interface AppoinRow {
  SECURITY_CODE?: string;
  SECURITY_NAME_ABBR?: string;
  APPOINT_PUBLISH_DATE?: string | null;
  ACTUAL_PUBLISH_DATE?: string | null;
  IS_PUBLISH?: string;
  REPORT_TYPE_NAME?: string;
}

export async function aShareEarnings(
  reportDate: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<EarningsEvent[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url =
    `${EM_URL}?reportName=RPT_PUBLIC_BS_APPOIN&columns=ALL&pageSize=50&pageNumber=1` +
    `&sortColumns=FIRST_APPOINT_DATE&sortTypes=1&filter=(REPORT_DATE='${reportDate}')`;
  const res = await doFetch(url, {
    headers: { Referer: "https://data.eastmoney.com/" },
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`eastmoney HTTP ${res.status}`);
  }
  const json = (await res.json()) as { result?: { data?: AppoinRow[] } | null };
  const rows = json.result?.data ?? [];
  return rows
    .filter((r): r is AppoinRow & { SECURITY_CODE: string } => Boolean(r.SECURITY_CODE))
    .map((r) => {
      const actual = (r.ACTUAL_PUBLISH_DATE ?? "").slice(0, 10);
      const appoint = (r.APPOINT_PUBLISH_DATE ?? "").slice(0, 10);
      return {
        market: "a" as const,
        symbol: r.SECURITY_CODE,
        name: r.SECURITY_NAME_ABBR ?? "",
        date: actual || appoint,
        reportType: r.REPORT_TYPE_NAME,
        isPublished: r.IS_PUBLISH === "是",
      };
    });
}

export function earningsCalendar(
  market: Market,
  date: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<EarningsEvent[]> {
  if (market === "us") {
    return usEarnings(date, opts);
  }
  if (market === "a") {
    return aShareEarnings(date, opts);
  }
  // HK: best-effort, not covered in v1.
  return Promise.resolve([]);
}
```

- [ ] **Step 8: Run + pass** (`pnpm -F finance-mcp test src/core/eastmoney/earnings.test.ts` → PASS)

- [ ] **Step 9: Tool def + dispatch + REST**

`tool-defs.ts`:

```ts
TOOLS.push({
  name: "finance_earnings_calendar",
  description:
    "Earnings / report-release dates. market='us' → Nasdaq calendar for a given day " +
    "(date=YYYY-MM-DD). market='a' → A-share appointed-disclosure schedule for a fiscal " +
    "period-end (date=YYYY-MM-DD, e.g. 2026-06-30 for H1). market='hk' is best-effort and " +
    "currently returns no data.",
  inputSchema: {
    type: "object",
    properties: {
      market: { type: "string", enum: ["us", "a", "hk"], description: "Market." },
      date: { type: "string", description: "US: calendar day. A-share: fiscal period-end (YYYY-MM-DD)." },
    },
    required: ["market", "date"],
    additionalProperties: false,
  },
});
TOOL_NAMES.add("finance_earnings_calendar");
```

`tools-impl.ts`:

```ts
if (name === "finance_earnings_calendar") {
  const market = _args.market === "us" || _args.market === "hk" ? _args.market : "a";
  const date = typeof _args.date === "string" ? _args.date : "";
  return toolJson(await earningsCalendar(market, date));
}
```

`rest.ts`:

```ts
app.get("/api/calendar/earnings", async (c) => {
  const m = c.req.query("market");
  const market = m === "us" || m === "hk" ? m : "a";
  const date = c.req.query("date") ?? "";
  return c.json(await earningsCalendar(market, date));
});
```

Add `import { earningsCalendar } from "./core/eastmoney/earnings";` in both.

- [ ] **Step 10: Run full suite + commit**

```bash
git add apps/finance-mcp/src
git commit -m "feat(finance-mcp): earnings calendar (A-share + US) — finance_earnings_calendar"
```

---

## Task 9: Economic calendar (Finnhub) + tool + REST

**Files:**
- Create: `apps/finance-mcp/src/core/finnhub/economic.ts`
- Create: `apps/finance-mcp/src/core/finnhub/economic.test.ts`
- Modify: `tool-defs.ts`, `tools-impl.ts`, `rest.ts`, `app.ts` (pass env), `worker.ts`

**Interfaces:**
- Consumes: `EconomicEvent`.
- Produces: `economicCalendar(from: string, to: string, apiKey: string, country: string | undefined, opts?): Promise<EconomicEvent[]>`. Throws `NotConfiguredError` if `apiKey` is empty.
- `NotConfiguredError extends Error` (define in `economic.ts`).
- The Worker env carries `FINNHUB_API_KEY`. Thread it: `app.ts` reads `c.env.FINNHUB_API_KEY` for REST; MCP dispatch needs it too — pass an `env` into `handleMessage`/`runTool` (see Step 6).

Finnhub: `https://finnhub.io/api/v1/calendar/economic?token=<KEY>` (optionally `&from=&to=`). Response `{ economicCalendar: [ { country, event, time, actual, estimate, prev, impact } ] }` (`time` like `2026-07-10 12:30:00`; date = first 10 chars).

- [ ] **Step 1: Write the failing test** — `core/finnhub/economic.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { economicCalendar, NotConfiguredError } from "./economic";

describe("economicCalendar", () => {
  it("throws NotConfiguredError without a key", async () => {
    await expect(economicCalendar("2026-07-01", "2026-07-15", "", undefined)).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("normalizes + filters by country", async () => {
    const payload = { economicCalendar: [
      { country: "US", event: "CPI YoY", time: "2026-07-10 12:30:00", actual: null, estimate: "3.1%", prev: "3.0%", impact: "high" },
      { country: "CN", event: "PPI YoY", time: "2026-07-09 01:30:00", actual: null, estimate: "-1.0%", prev: "-1.2%", impact: "medium" },
    ] };
    const fetchImpl = async () => new Response(JSON.stringify(payload));
    const us = await economicCalendar("2026-07-01", "2026-07-15", "KEY", "US", { fetchImpl: fetchImpl as typeof fetch });
    expect(us).toHaveLength(1);
    expect(us[0]).toMatchObject({ country: "US", event: "CPI YoY", date: "2026-07-10", estimate: "3.1%", prior: "3.0%", impact: "high" });
  });
});
```

- [ ] **Step 2: Run + fail**

Run: `pnpm -F finance-mcp test src/core/finnhub/economic.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Create `core/finnhub/economic.ts`**

```ts
import type { EconomicEvent } from "../types";

export class NotConfiguredError extends Error {}

const FINNHUB_URL = "https://finnhub.io/api/v1/calendar/economic";

interface FhRow {
  country?: string; event?: string; time?: string;
  actual?: string | null; estimate?: string | null; prev?: string | null; impact?: string;
}

export async function economicCalendar(
  from: string,
  to: string,
  apiKey: string,
  country: string | undefined,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<EconomicEvent[]> {
  if (!apiKey) {
    throw new NotConfiguredError("FINNHUB_API_KEY is not set");
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${FINNHUB_URL}?from=${from}&to=${to}&token=${apiKey}`;
  const res = await doFetch(url, { signal: opts.signal });
  if (!res.ok) {
    throw new Error(`finnhub HTTP ${res.status}`);
  }
  const json = (await res.json()) as { economicCalendar?: FhRow[] | null };
  const rows = json.economicCalendar ?? [];
  const wanted = country?.toUpperCase();
  return rows
    .filter((r) => !wanted || (r.country ?? "").toUpperCase() === wanted)
    .map((r) => ({
      country: r.country ?? "",
      event: r.event ?? "",
      date: (r.time ?? "").slice(0, 10),
      time: (r.time ?? "").slice(11),
      actual: r.actual ?? undefined,
      estimate: r.estimate ?? undefined,
      prior: r.prev ?? undefined,
      impact: r.impact,
    }));
}
```

- [ ] **Step 4: Run + pass** (`pnpm -F finance-mcp test src/core/finnhub/economic.test.ts` → PASS)

- [ ] **Step 5: Thread env through the worker**

In `worker.ts`, switch to the fetch-handler form so `env` is available:

```ts
import { initLogger } from "evlog";
import { buildApp } from "./app";

initLogger({ env: { service: "better-agent-finance-mcp" } });

const app = buildApp();

export default {
  fetch: (req: Request, env: Record<string, string>, ctx: ExecutionContext) =>
    app.fetch(req, env, ctx),
};
```

In `app.ts`, `POST /mcp` now reads env and passes it to `handleMessage(message, c.env)`. Update `handleMessage`/`callTool`/`runTool` signatures to accept `env: { FINNHUB_API_KEY?: string }` as a trailing arg (default `{}`), and pass it into the `finance_economic_calendar` branch. REST reads `c.env.FINNHUB_API_KEY`.

- [ ] **Step 6: Tool def + dispatch + REST**

`tool-defs.ts`:

```ts
TOOLS.push({
  name: "finance_economic_calendar",
  description:
    "Macro economic data-release schedule (CPI, PPI, non-farm payrolls, GDP, FOMC, PMI) " +
    "with actual/estimate/prior. Covers US and China. from/to are YYYY-MM-DD; country is an " +
    "optional ISO-2 filter (US, CN).",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Start date YYYY-MM-DD." },
      to: { type: "string", description: "End date YYYY-MM-DD." },
      country: { type: "string", description: "Optional ISO-2 filter, e.g. US or CN." },
    },
    required: ["from", "to"],
    additionalProperties: false,
  },
});
TOOL_NAMES.add("finance_economic_calendar");
```

`tools-impl.ts` (branch, uses `env`):

```ts
if (name === "finance_economic_calendar") {
  const from = typeof _args.from === "string" ? _args.from : "";
  const to = typeof _args.to === "string" ? _args.to : "";
  const country = typeof _args.country === "string" ? _args.country : undefined;
  return toolJson(await economicCalendar(from, to, env.FINNHUB_API_KEY ?? "", country));
}
```

`rest.ts` (registerRest also receives env via closure — pass `c.env`):

```ts
app.get("/api/calendar/economic", async (c) => {
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";
  const country = c.req.query("country") ?? undefined;
  const key = (c.env as { FINNHUB_API_KEY?: string }).FINNHUB_API_KEY ?? "";
  return c.json(await economicCalendar(from, to, key, country));
});
```

Map `NotConfiguredError` → HTTP 503 in a Hono `onError` (add to `app.ts`): if `err instanceof NotConfiguredError` return `c.json({ error: err.message }, 503)`.

- [ ] **Step 7: Update `mcp-server.test.ts`** — the `unknown tool` and handshake tests must still pass with the new `env` arg (call `handleMessage(msg, {})`). Update those call sites.

- [ ] **Step 8: Run full suite + commit**

```bash
git add apps/finance-mcp/src
git commit -m "feat(finance-mcp): finnhub economic calendar — finance_economic_calendar"
```

---

## Task 10: Central-bank operations (PBOC + Fed) + tool + REST

**Files:**
- Create: `apps/finance-mcp/src/core/eastmoney/central-bank.ts`
- Create: `apps/finance-mcp/src/core/us/nyfed.ts`
- Create: `apps/finance-mcp/src/core/eastmoney/central-bank.test.ts`
- Create: `apps/finance-mcp/src/core/us/nyfed.test.ts`
- Modify: `tool-defs.ts`, `tools-impl.ts`, `rest.ts`

**Interfaces:**
- Consumes: `CbOp`.
- Produces:
  - `pbocOps(opts?): Promise<CbOp[]>` — NY-Fed-style but for PBOC via EastMoney datacenter. Report name resolved from akshare at implementation time; the connector shape below is fixed. If the report name is not yet confirmed, fetch from the fallback and return `[]` on parse failure (never throw for empty data).
  - `fedOps(opts?): Promise<CbOp[]>` — NY Fed `markets.newyorkfed.org/api/rp/all/latest.json`.
  - `centralBank(market, opts?): Promise<CbOp[]>` dispatcher.

NY Fed response: `{ repo: { operations: [ { operationDate, operationType, totalAmtAccepted, ... } ] } }` (shape confirmed at implementation from `markets.newyorkfed.org/static/docs/markets-api.html`).

- [ ] **Step 1: Write the failing test** — `core/us/nyfed.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { fedOps } from "./nyfed";

describe("fedOps", () => {
  it("normalizes NY Fed repo operations", async () => {
    const payload = { repo: { operations: [
      { operationDate: "2026-07-07", operationType: "Reverse Repo", totalAmtAccepted: 250000000000 },
    ] } };
    const fetchImpl = async () => new Response(JSON.stringify(payload));
    const ops = await fedOps({ fetchImpl: fetchImpl as typeof fetch });
    expect(ops[0]).toMatchObject({ date: "2026-07-07", type: "Reverse Repo", amount: 250000000000 });
  });

  it("returns [] on unexpected shape", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({}));
    expect(await fedOps({ fetchImpl: fetchImpl as typeof fetch })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run + fail; Step 3: Create `core/us/nyfed.ts`**

```ts
import type { CbOp } from "../types";

const NYFED_URL = "https://markets.newyorkfed.org/api/rp/all/latest.json";

interface RpOp { operationDate?: string; operationType?: string; totalAmtAccepted?: number }

export async function fedOps(
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<CbOp[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(NYFED_URL, { signal: opts.signal });
  if (!res.ok) {
    throw new Error(`nyfed HTTP ${res.status}`);
  }
  const json = (await res.json()) as { repo?: { operations?: RpOp[] } };
  const ops = json.repo?.operations ?? [];
  return ops
    .filter((o): o is RpOp & { operationDate: string } => Boolean(o.operationDate))
    .map((o) => ({
      date: o.operationDate,
      type: o.operationType ?? "repo",
      amount: o.totalAmtAccepted,
    }));
}
```

- [ ] **Step 4: Run + pass.**

- [ ] **Step 5: Write the failing test** — `core/eastmoney/central-bank.test.ts` (PBOC OMO; fixture shape below is the contract the connector normalizes to)

```ts
import { describe, expect, it } from "vitest";
import { pbocOps } from "./central-bank";

describe("pbocOps", () => {
  it("normalizes reverse-repo rows", async () => {
    const payload = { result: { data: [
      { TRADE_DATE: "2026-07-08 00:00:00", SECURITY_NAME_ABBR: "7天逆回购", VALUE: 1500, INTEREST_RATE: 1.4, TERM: "7天" },
    ] } };
    const fetchImpl = async () => new Response(JSON.stringify(payload));
    const ops = await pbocOps({ fetchImpl: fetchImpl as typeof fetch });
    expect(ops[0]).toMatchObject({ date: "2026-07-08", type: "7天逆回购", amount: 1500, rate: 1.4, tenor: "7天" });
  });

  it("returns [] on empty", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ result: { data: [] } }));
    expect(await pbocOps({ fetchImpl: fetchImpl as typeof fetch })).toEqual([]);
  });
});
```

- [ ] **Step 6: Run + fail; Step 7: Create `core/eastmoney/central-bank.ts`**

```ts
import type { CbOp } from "../types";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
// Report name for PBOC open-market operations. Confirm against akshare
// macro_china_open_operation at implementation; keep the normalization stable.
const REPORT_NAME = "RPT_OPEN_MARKET_REPO";

interface OmoRow {
  TRADE_DATE?: string;
  SECURITY_NAME_ABBR?: string;
  VALUE?: number;
  INTEREST_RATE?: number;
  TERM?: string;
}

export async function pbocOps(
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<CbOp[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const url =
    `${EM_URL}?reportName=${REPORT_NAME}&columns=ALL&pageSize=50&pageNumber=1` +
    "&sortColumns=TRADE_DATE&sortTypes=-1";
  try {
    const res = await doFetch(url, {
      headers: { Referer: "https://data.eastmoney.com/" },
      signal: opts.signal,
    });
    if (!res.ok) {
      return [];
    }
    const json = (await res.json()) as { result?: { data?: OmoRow[] } | null };
    const rows = json.result?.data ?? [];
    return rows
      .filter((r): r is OmoRow & { TRADE_DATE: string } => Boolean(r.TRADE_DATE))
      .map((r) => ({
        date: r.TRADE_DATE.slice(0, 10),
        type: r.SECURITY_NAME_ABBR ?? "逆回购",
        amount: r.VALUE,
        rate: r.INTEREST_RATE,
        tenor: r.TERM,
      }));
  } catch {
    return [];
  }
}
```

Add the dispatcher at the bottom:

```ts
import { fedOps } from "../us/nyfed";
import type { Market } from "../types";

export function centralBank(
  market: Market,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<CbOp[]> {
  return market === "us" ? fedOps(opts) : pbocOps(opts);
}
```

(Place imports at top of file, not mid-file.)

- [ ] **Step 8: Run + pass.**

- [ ] **Step 9: Tool def + dispatch + REST**

`tool-defs.ts`:

```ts
TOOLS.push({
  name: "finance_central_bank",
  description:
    "Recent central-bank money-market operations. market='cn' → PBOC reverse-repo / MLF " +
    "(amount 亿元, rate, tenor). market='us' → NY Fed repo/reverse-repo operations.",
  inputSchema: {
    type: "object",
    properties: { market: { type: "string", enum: ["cn", "us"], description: "cn (PBOC) or us (Fed)." } },
    required: ["market"],
    additionalProperties: false,
  },
});
TOOL_NAMES.add("finance_central_bank");
```

`tools-impl.ts`:

```ts
if (name === "finance_central_bank") {
  const market = _args.market === "us" ? "us" : "a"; // "cn" maps to the non-us branch
  return toolJson(await centralBank(market as "us" | "a", { }));
}
```

(Note: `centralBank` treats any non-`us` market as PBOC; passing `"a"` is fine.)

`rest.ts`:

```ts
app.get("/api/calendar/central-bank", async (c) => {
  const market = c.req.query("market") === "us" ? "us" : "a";
  return c.json(await centralBank(market));
});
```

Add `import { centralBank } from "./core/eastmoney/central-bank";` in both.

- [ ] **Step 10: Verify the PBOC report name live**

Run: `curl -s "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_OPEN_MARKET_REPO&columns=ALL&pageSize=5&pageNumber=1&sortColumns=TRADE_DATE&sortTypes=-1" -H "Referer: https://data.eastmoney.com/"`
Expected: JSON with `result.data`. If it returns `9501 报表配置不存在`, open `data.eastmoney.com/cjsj/` money-market pages or akshare `macro_china.py` to get the exact `reportName` + column names, then update `REPORT_NAME` and the `OmoRow` field names to match, and re-run the test with a fixture captured from the working response. The connector returns `[]` on failure, so the tool degrades gracefully until then.

- [ ] **Step 11: Run full suite + commit**

```bash
git add apps/finance-mcp/src
git commit -m "feat(finance-mcp): central-bank ops (PBOC + NY Fed) — finance_central_bank"
```

---

## Task 11: Response caching (Cache API)

**Files:**
- Create: `apps/finance-mcp/src/core/cache.ts`
- Create: `apps/finance-mcp/src/core/cache.test.ts`
- Modify: `rest.ts` and `tools-impl.ts` to wrap calls with `withCache`.

**Interfaces:**
- Produces: `withCache<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T>`. Uses the Workers global `caches.default`; on a miss runs `fn`, stores a synthetic `Response` with `Cache-Control: max-age=<ttl>`, returns the value. In a non-Worker test env (`caches` undefined), it must fall through to `fn()` directly.

Chosen TTLs: quote 5s, kline 300s, reports 3600s, earnings 1800s, economic 1800s, central-bank 1800s.

- [ ] **Step 1: Write the failing test** — `core/cache.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { withCache } from "./cache";

describe("withCache", () => {
  it("falls through to fn when caches is unavailable (test env)", async () => {
    const fn = vi.fn(async () => ({ v: 1 }));
    const out = await withCache("k1", 60, fn);
    expect(out).toEqual({ v: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run + fail; Step 3: Create `core/cache.ts`**

```ts
interface CachesLike {
  default: {
    match(req: Request): Promise<Response | undefined>;
    put(req: Request, res: Response): Promise<void>;
  };
}

function cacheStore(): CachesLike["default"] | null {
  const c = (globalThis as unknown as { caches?: CachesLike }).caches;
  return c?.default ?? null;
}

export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  const store = cacheStore();
  if (!store) {
    return fn();
  }
  const req = new Request(`https://cache.local/${encodeURIComponent(key)}`);
  const hit = await store.match(req);
  if (hit) {
    return (await hit.json()) as T;
  }
  const value = await fn();
  const res = new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json", "cache-control": `max-age=${ttlSeconds}` },
  });
  await store.put(req, res);
  return value;
}
```

- [ ] **Step 4: Run + pass.**

- [ ] **Step 5: Wrap the hot paths** — in `rest.ts` and `tools-impl.ts`, wrap each core call, e.g.:

```ts
// quote
return toolJson(await withCache(`quote:${symbol}`, 5, () => getQuote(symbol)));
// kline
await withCache(`kline:${symbol}:${period}:${limit}`, 300, () => getKline(symbol, period, limit));
// reports
await withCache(`reports:${symbol}:${years}`, 3600, () => listReports(symbol, years));
// earnings
await withCache(`earn:${market}:${date}`, 1800, () => earningsCalendar(market, date));
// economic (include country in key)
await withCache(`econ:${from}:${to}:${country ?? "all"}`, 1800, () => economicCalendar(from, to, key, country));
// central-bank
await withCache(`cb:${market}`, 1800, () => centralBank(market));
```

Apply the same wrapping in both `tools-impl.ts` and `rest.ts`. Add `import { withCache } from "./core/cache";` (adjust relative path per file).

- [ ] **Step 6: Run full suite + commit**

```bash
git add apps/finance-mcp/src
git commit -m "feat(finance-mcp): edge caching via Cache API with per-source TTLs"
```

---

## Task 12: Deploy wiring

**Files:**
- Modify: `apps/finance-mcp/wrangler.toml` (KV namespace + secret note)
- Modify: `.github/workflows/deploy-test.yml` (add a `finance-mcp` job)

**Interfaces:** none (CI/CD).

- [ ] **Step 1: Confirm `check-types` and tests are green**

Run: `pnpm -F finance-mcp check-types && pnpm -F finance-mcp test`
Expected: no type errors, all tests PASS.

- [ ] **Step 2: Lint**

Run: `pnpm dlx ultracite check apps/finance-mcp`
Expected: clean (fix anything it flags, e.g. import ordering).

- [ ] **Step 3: Add the deploy job** — append to `.github/workflows/deploy-test.yml` (sibling of the `mcp` job)

```yaml
  finance-mcp:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Test finance-mcp
        run: pnpm -F finance-mcp test
      - name: Deploy finance-mcp
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/finance-mcp
          command: deploy
          secrets: |
            FINNHUB_API_KEY
        env:
          FINNHUB_API_KEY: ${{ secrets.FINNHUB_API_KEY }}
```

- [ ] **Step 4: Note the manual prerequisites** in the PR/commit description:
  - Add repo secret `FINNHUB_API_KEY` (free key from finnhub.io).
  - The Worker uses `caches.default` (no binding needed). No KV namespace is required for v1 (Cache API is implicit). If you later switch to KV, add `[[kv_namespaces]]` to `wrangler.toml` and create it with `wrangler kv namespace create finance_cache`.

- [ ] **Step 5: Commit**

```bash
git add apps/finance-mcp/wrangler.toml .github/workflows/deploy-test.yml
git commit -m "ci(finance-mcp): deploy job on dev push + FINNHUB_API_KEY secret"
```

- [ ] **Step 6: Smoke-test locally before pushing**

Run: `cd apps/finance-mcp && pnpm dev` then in another shell:
```bash
curl -s "http://localhost:3005/api/quote?symbol=600000.SH"
curl -s "http://localhost:3005/api/kline?symbol=AAPL&period=day&limit=5"
curl -s "http://localhost:3005/api/reports?symbol=600000.SH"
curl -s -X POST "http://localhost:3005/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
Expected: real JSON from each; `tools/list` shows all six `finance_*` tools. Confirm the Chinese `name` field in `/api/quote` decodes correctly (validates GBK on the deployed-style runtime).

---

## Self-Review (completed during planning)

- **Spec coverage:** Feature 1 calendar → Tasks 8–10 (earnings/economic/central-bank). Feature 2 quotes+kline → Tasks 4–5. Feature 3 reports+PDF → Tasks 6–7. Shared core + MCP + REST + auth-public + caching → Tasks 1–3, 11. Deploy → Task 12. All spec sections map to a task.
- **Deviations from spec (intentional, noted here):** (a) K-line minute periods (`5m/15m/30m/60m`) are deferred to a follow-up — v1 ships `day/week/month` (the confirmed `fqkline` endpoint); the tool's `period` enum is limited to those three. (b) Realtime depth is **5档**, not 10 — free Tencent snapshot only exposes five levels (verified live); the `bids/asks` arrays already accommodate more if a 10档 source is added later. (c) HK earnings return `[]` in v1 (best-effort, per spec).
- **Placeholder scan:** No "TBD/implement later". Two live-verification steps (GBK decoding in Task 4 Step 5; PBOC report name in Task 10 Step 10) are explicit, bounded checks with a defined fallback — not deferred work.
- **Type consistency:** `parseSymbol` returns `{ market, code, tencent }` (Task 3) and is consumed unchanged in Tasks 4/5/6. `Quote/Candle/Report/EarningsEvent/EconomicEvent/CbOp` defined once in `types.ts` and reused. `toolJson`/`toolText` defined in Task 2, used throughout. `withCache` signature (Task 11) matches its call sites.
```

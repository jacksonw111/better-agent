// R4-T1: codex's account quota — reads the user's LOCAL codex OAuth
// credentials from `~/.codex/auth.json` (the same file hermes's own
// account_usage.py reads) and GETs the ChatGPT backend's `wham/usage`
// endpoint to answer "how much of my plan's rate limit is left". Runs
// entirely client-side, in bridge-cli — the server never sees the token.
//
// Fail-open EVERYWHERE (see `QuotaSnapshot`'s doc comment in ../types.ts):
// a missing/malformed auth file, a network error, a non-2xx response, or a
// >5s hang all resolve to a `QuotaSnapshot` carrying only
// `unavailableReason`, never a rejected promise or a thrown error.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { asString, isRecord } from "../../normalize/types";
import type { QuotaSnapshot, QuotaWindow } from "../types";
import { asNumber, fetchWithTimeout, unavailableQuota } from "./quota-shared";

const CODEX_AUTH_PATH = join(homedir(), ".codex", "auth.json");
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const FETCH_TIMEOUT_MS = 5000;

interface CodexCreds {
	accessToken: string;
	accountId?: string;
}

/** The first candidate that parses as a non-empty string, or `undefined` if
 * none do — collapses a chain of `asString(a) ?? asString(b) ?? …` into one
 * branch instead of N, keeping the callers' cyclomatic complexity down. */
function firstString(...candidates: unknown[]): string | undefined {
	for (const candidate of candidates) {
		const value = asString(candidate);
		if (value !== undefined) {
			return value;
		}
	}
	// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
	return undefined;
}

/**
 * ASSUMPTION (unverified against a real `~/.codex/auth.json` — extracted
 * defensively so whichever of these shapes is the real one still works):
 * the access token lives at `tokens.access_token`, or the top-level
 * `access_token`; the ChatGPT account id at `tokens.account_id`,
 * `tokens.chatgpt_account_id`, or the equivalent top-level fields.
 */
export function parseCodexAuthFile(raw: unknown): CodexCreds | null {
	if (!isRecord(raw)) {
		return null;
	}
	const tokens = isRecord(raw.tokens) ? raw.tokens : undefined;
	const accessToken = firstString(tokens?.access_token, raw.access_token);
	if (!accessToken) {
		return null;
	}
	const accountId = firstString(
		tokens?.account_id,
		tokens?.chatgpt_account_id,
		raw.account_id,
		raw.chatgpt_account_id
	);
	return accountId === undefined ? { accessToken } : { accessToken, accountId };
}

/** codex's `rate_limit.{primary,secondary}_window` → one `QuotaWindow`, or
 * `undefined` if the window is absent or missing its used-percent figure. */
function parseRateLimitWindow(
	label: string,
	value: unknown
): QuotaWindow | undefined {
	if (!isRecord(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const usedPercent = asNumber(value.used_percent);
	if (usedPercent === undefined) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return { label, usedPercent, resetsAt: asString(value.resets_at) };
}

/** ASSUMPTION: `credits.balance` has no natural "percent used" reading (it's
 * a remaining-balance figure, not a window) — surfaced as its own zero-usage
 * window carrying the balance in `detail` rather than dropped, so the web
 * still has somewhere to show it. */
function creditsWindow(
	payload: Record<string, unknown>
): QuotaWindow | undefined {
	const credits = isRecord(payload.credits) ? payload.credits : undefined;
	const balance = asNumber(credits?.balance);
	if (balance === undefined) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	return { label: "Credits", usedPercent: 0, detail: `Balance: ${balance}` };
}

/** Parses a `wham/usage` response body into a `QuotaSnapshot` — never
 * throws; a payload that isn't the expected shape just yields no windows. */
export function parseCodexQuotaResponse(
	payload: unknown,
	fetchedAt: string
): QuotaSnapshot {
	if (!isRecord(payload)) {
		return unavailableQuota(
			"codex",
			fetchedAt,
			"malformed wham/usage response"
		);
	}
	const rateLimit = isRecord(payload.rate_limit) ? payload.rate_limit : {};
	const windows = [
		parseRateLimitWindow("5小时窗口", rateLimit.primary_window),
		parseRateLimitWindow("本周", rateLimit.secondary_window),
		creditsWindow(payload),
	].filter((window): window is QuotaWindow => window !== undefined);
	return { provider: "codex", windows, fetchedAt };
}

async function readCodexCreds(authPath: string): Promise<CodexCreds | null> {
	try {
		const raw = JSON.parse(await readFile(authPath, "utf8"));
		return parseCodexAuthFile(raw);
	} catch {
		return null;
	}
}

export interface CodexQuotaDeps {
	authPath?: string;
	fetchImpl?: typeof fetch;
	now?: () => Date;
	timeoutMs?: number;
}

function buildCodexHeaders(creds: CodexCreds): Record<string, string> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${creds.accessToken}`,
	};
	if (creds.accountId) {
		headers["ChatGPT-Account-Id"] = creds.accountId;
	}
	return headers;
}

/** GETs `wham/usage` and parses the reply — split out of `fetchCodexQuota`
 * purely to keep that function's cyclomatic complexity under the repo's
 * lint gate; the try/catch around this call stays in the caller. */
async function requestCodexQuota(
	deps: Required<Pick<CodexQuotaDeps, "fetchImpl" | "timeoutMs">>,
	headers: Record<string, string>,
	fetchedAt: string
): Promise<QuotaSnapshot> {
	const response = await fetchWithTimeout(
		deps.fetchImpl,
		CODEX_USAGE_URL,
		{ headers },
		deps.timeoutMs
	);
	if (!response.ok) {
		return unavailableQuota(
			"codex",
			fetchedAt,
			`wham/usage returned ${response.status}`
		);
	}
	return parseCodexQuotaResponse(await response.json(), fetchedAt);
}

/** Fetches codex's account quota — see the module doc comment for the
 * fail-open contract. */
export async function fetchCodexQuota(
	deps: CodexQuotaDeps = {}
): Promise<QuotaSnapshot> {
	const {
		authPath = CODEX_AUTH_PATH,
		fetchImpl = fetch,
		now = () => new Date(),
		timeoutMs = FETCH_TIMEOUT_MS,
	} = deps;
	const fetchedAt = now().toISOString();
	const creds = await readCodexCreds(authPath);
	if (!creds) {
		return unavailableQuota("codex", fetchedAt, "codex credentials not found");
	}
	try {
		return await requestCodexQuota(
			{ fetchImpl, timeoutMs },
			buildCodexHeaders(creds),
			fetchedAt
		);
	} catch (error) {
		return unavailableQuota(
			"codex",
			fetchedAt,
			error instanceof Error ? error.message : "codex quota fetch failed"
		);
	}
}

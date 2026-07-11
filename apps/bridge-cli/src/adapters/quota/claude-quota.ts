// R4-T1: claude's account quota — reads the user's LOCAL claude-code OAuth
// credentials (the same file the `claude` CLI/SDK write) and GETs
// anthropic's `oauth/usage` endpoint to answer "how much of my plan's
// rate-limit windows are left". Runs entirely client-side, in bridge-cli —
// the server never sees the token.
//
// Fail-open EVERYWHERE (see `QuotaSnapshot`'s doc comment in ../types.ts):
// a missing/malformed credentials file (or a keychain-only account, which
// this file-only probe can't read at all), a network error, a non-2xx
// response, or a >5s hang all resolve to a `QuotaSnapshot` carrying only
// `unavailableReason`, never a rejected promise or a thrown error.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { asString, isRecord } from "../../normalize/types";
import type { QuotaSnapshot, QuotaWindow } from "../types";
import { asNumber, fetchWithTimeout, unavailableQuota } from "./quota-shared";

const CLAUDE_CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const FETCH_TIMEOUT_MS = 5000;
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const USER_AGENT = "claude-code/2.1.0";

/** The four rate-limit windows claude's `oauth/usage` reports, in the order
 * the brief lists them — each mapped to its Chinese display label. */
const WINDOW_LABELS: readonly [key: string, label: string][] = [
	["five_hour", "本次会话"],
	["seven_day", "本周"],
	["seven_day_opus", "Opus 周"],
	["seven_day_sonnet", "Sonnet 周"],
];

/**
 * ASSUMPTION (unverified against a real `~/.claude/.credentials.json`):
 * the real shape observed from claude-code itself is
 * `{ claudeAiOauth: { accessToken, refreshToken, expiresAt, scopes,
 * subscriptionType } }` — extracted defensively, also accepting a
 * top-level `accessToken`/`access_token` in case a future version flattens
 * it. A keychain-only account (macOS) has no such file at all, so this
 * probe naturally returns `null` for it — see `fetchClaudeQuota`'s
 * "credentials not accessible" fallback.
 */
export function parseClaudeCredentialsFile(raw: unknown): string | null {
	if (!isRecord(raw)) {
		return null;
	}
	const oauth = isRecord(raw.claudeAiOauth) ? raw.claudeAiOauth : undefined;
	return (
		asString(oauth?.accessToken) ??
		asString(raw.accessToken) ??
		asString(raw.access_token) ??
		null
	);
}

/** claude's `{utilization, resets_at}` window → one `QuotaWindow`. ASSUMPTION:
 * `utilization` is normalized to 0–100 already (defensively re-scaled here
 * if it instead arrives as a 0–1 fraction, per the brief's "normalized
 * 0-100"). */
function parseUsageWindow(
	label: string,
	value: unknown
): QuotaWindow | undefined {
	if (!isRecord(value)) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const raw = asNumber(value.utilization);
	if (raw === undefined) {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const usedPercent = raw > 0 && raw <= 1 ? raw * 100 : raw;
	return { label, usedPercent, resetsAt: asString(value.resets_at) };
}

/** ASSUMPTION: an API-key (non-OAuth) account gets back a response with no
 * window data at all, plus a human-readable `error`/`message` string
 * explaining why — surfaced verbatim as `unavailableReason` rather than
 * silently producing an empty-but-"available" snapshot. */
function apiKeyAccountReason(
	payload: Record<string, unknown>
): string | undefined {
	return asString(payload.error) ?? asString(payload.message);
}

/** Parses an `oauth/usage` response body into a `QuotaSnapshot` — never
 * throws. */
export function parseClaudeQuotaResponse(
	payload: unknown,
	fetchedAt: string
): QuotaSnapshot {
	if (!isRecord(payload)) {
		return unavailableQuota(
			"claude",
			fetchedAt,
			"malformed oauth/usage response"
		);
	}
	const windows = WINDOW_LABELS.map(([key, label]) =>
		parseUsageWindow(label, payload[key])
	).filter((window): window is QuotaWindow => window !== undefined);
	if (windows.length === 0) {
		const reason = apiKeyAccountReason(payload);
		if (reason) {
			return unavailableQuota("claude", fetchedAt, reason);
		}
	}
	return { provider: "claude", windows, fetchedAt };
}

async function readClaudeAccessToken(
	credentialsPath: string
): Promise<string | null> {
	try {
		const raw = JSON.parse(await readFile(credentialsPath, "utf8"));
		return parseClaudeCredentialsFile(raw);
	} catch {
		return null;
	}
}

export interface ClaudeQuotaDeps {
	credentialsPath?: string;
	fetchImpl?: typeof fetch;
	now?: () => Date;
	timeoutMs?: number;
}

/** Fetches claude's account quota — see the module doc comment for the
 * fail-open contract. */
export async function fetchClaudeQuota(
	deps: ClaudeQuotaDeps = {}
): Promise<QuotaSnapshot> {
	const {
		credentialsPath = CLAUDE_CREDENTIALS_PATH,
		fetchImpl = fetch,
		now = () => new Date(),
		timeoutMs = FETCH_TIMEOUT_MS,
	} = deps;
	const fetchedAt = now().toISOString();
	const accessToken = await readClaudeAccessToken(credentialsPath);
	if (!accessToken) {
		return unavailableQuota("claude", fetchedAt, "credentials not accessible");
	}
	try {
		const response = await fetchWithTimeout(
			fetchImpl,
			CLAUDE_USAGE_URL,
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"anthropic-beta": OAUTH_BETA_HEADER,
					"User-Agent": USER_AGENT,
				},
			},
			timeoutMs
		);
		if (!response.ok) {
			return unavailableQuota(
				"claude",
				fetchedAt,
				`oauth/usage returned ${response.status}`
			);
		}
		return parseClaudeQuotaResponse(await response.json(), fetchedAt);
	} catch (error) {
		return unavailableQuota(
			"claude",
			fetchedAt,
			error instanceof Error ? error.message : "claude quota fetch failed"
		);
	}
}

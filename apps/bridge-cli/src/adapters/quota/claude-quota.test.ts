import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	fetchClaudeQuota,
	parseClaudeCredentialsFile,
	parseClaudeQuotaResponse,
} from "./claude-quota";

// R4-T1: claude quota fetch/parse — fake fetch + a real temp-dir credentials
// file, never a real network call (per the brief).

let dir: string;
let credentialsPath: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "ba-claude-quota-"));
	credentialsPath = join(dir, ".credentials.json");
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status });
}

it("parses the access token off claudeAiOauth.accessToken", () => {
	expect(
		parseClaudeCredentialsFile({ claudeAiOauth: { accessToken: "tok" } })
	).toBe("tok");
});

it("falls back to a top-level accessToken/access_token field", () => {
	expect(parseClaudeCredentialsFile({ accessToken: "tok" })).toBe("tok");
	expect(parseClaudeCredentialsFile({ access_token: "tok" })).toBe("tok");
});

it("returns null when no access token is present anywhere", () => {
	expect(parseClaudeCredentialsFile({ claudeAiOauth: {} })).toBeNull();
	expect(parseClaudeCredentialsFile("nope")).toBeNull();
});

it("parses all four rate-limit windows with their Chinese labels", () => {
	const snapshot = parseClaudeQuotaResponse(
		{
			five_hour: { utilization: 20, resets_at: "2026-07-11T18:00:00Z" },
			seven_day: { utilization: 55 },
			seven_day_opus: { utilization: 5 },
			seven_day_sonnet: { utilization: 12 },
		},
		"2026-07-11T12:00:00Z"
	);
	expect(snapshot.provider).toBe("claude");
	expect(snapshot.windows).toEqual([
		{ label: "本次会话", usedPercent: 20, resetsAt: "2026-07-11T18:00:00Z" },
		{ label: "本周", usedPercent: 55, resetsAt: undefined },
		{ label: "Opus 周", usedPercent: 5, resetsAt: undefined },
		{ label: "Sonnet 周", usedPercent: 12, resetsAt: undefined },
	]);
});

it("re-scales a 0-1 fraction utilization up to a 0-100 percent", () => {
	const snapshot = parseClaudeQuotaResponse(
		{ five_hour: { utilization: 0.42 } },
		"t"
	);
	expect(snapshot.windows[0]?.usedPercent).toBe(42);
});

it("surfaces the response's own error/message as unavailableReason for an API-key account", () => {
	const snapshot = parseClaudeQuotaResponse(
		{ error: "This account does not use OAuth" },
		"t"
	);
	expect(snapshot.windows).toEqual([]);
	expect(snapshot.unavailableReason).toBe("This account does not use OAuth");
});

it("fetches the credentials file and GETs oauth/usage with the oauth headers", async () => {
	await writeFile(
		credentialsPath,
		JSON.stringify({ claudeAiOauth: { accessToken: "tok" } })
	);
	const fetchImpl = vi.fn(() =>
		Promise.resolve(jsonResponse(200, { five_hour: { utilization: 3 } }))
	);

	const snapshot = await fetchClaudeQuota({
		credentialsPath,
		fetchImpl,
		now: () => new Date("2026-07-11T12:00:00Z"),
	});

	expect(fetchImpl).toHaveBeenCalledWith(
		"https://api.anthropic.com/api/oauth/usage",
		expect.objectContaining({
			headers: {
				Authorization: "Bearer tok",
				"anthropic-beta": "oauth-2025-04-20",
				"User-Agent": "claude-code/2.1.0",
			},
		})
	);
	expect(snapshot.windows[0]?.usedPercent).toBe(3);
});

it("fails open with 'credentials not accessible' when the file is missing", async () => {
	const fetchImpl = vi.fn();
	const snapshot = await fetchClaudeQuota({ credentialsPath, fetchImpl });
	expect(snapshot.unavailableReason).toBe("credentials not accessible");
	expect(fetchImpl).not.toHaveBeenCalled();
});

it("fails open on malformed JSON in the credentials file", async () => {
	await writeFile(credentialsPath, "{not json");
	const snapshot = await fetchClaudeQuota({
		credentialsPath,
		fetchImpl: vi.fn(),
	});
	expect(snapshot.unavailableReason).toBeDefined();
});

it("fails open on a non-2xx HTTP response", async () => {
	await writeFile(
		credentialsPath,
		JSON.stringify({ claudeAiOauth: { accessToken: "tok" } })
	);
	const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(403, {})));
	const snapshot = await fetchClaudeQuota({ credentialsPath, fetchImpl });
	expect(snapshot.unavailableReason).toContain("403");
});

it("fails open when fetch rejects (network error)", async () => {
	await writeFile(
		credentialsPath,
		JSON.stringify({ claudeAiOauth: { accessToken: "tok" } })
	);
	const fetchImpl = vi.fn(() => Promise.reject(new Error("ETIMEDOUT")));
	const snapshot = await fetchClaudeQuota({ credentialsPath, fetchImpl });
	expect(snapshot.unavailableReason).toBe("ETIMEDOUT");
});

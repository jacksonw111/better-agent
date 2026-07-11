import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	fetchCodexQuota,
	parseCodexAuthFile,
	parseCodexQuotaResponse,
} from "./codex-quota";

// R4-T1: codex quota fetch/parse — every case runs against a fake fetch and
// a real temp-dir auth.json (never a real network call, per the brief).

let dir: string;
let authPath: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "ba-codex-quota-"));
	authPath = join(dir, "auth.json");
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status });
}

it("parses the access token + account id off tokens.*", () => {
	expect(
		parseCodexAuthFile({
			tokens: { access_token: "tok", account_id: "acct" },
		})
	).toEqual({ accessToken: "tok", accountId: "acct" });
});

it("falls back to top-level access_token/account_id fields", () => {
	expect(
		parseCodexAuthFile({ access_token: "tok", account_id: "acct" })
	).toEqual({ accessToken: "tok", accountId: "acct" });
});

it("returns null for a file with no access token anywhere", () => {
	expect(parseCodexAuthFile({ tokens: {} })).toBeNull();
	expect(parseCodexAuthFile("not an object")).toBeNull();
});

it("parses both rate-limit windows and the credits balance", () => {
	const snapshot = parseCodexQuotaResponse(
		{
			rate_limit: {
				primary_window: { used_percent: 42, resets_at: "2026-07-11T00:00:00Z" },
				secondary_window: {
					used_percent: 10,
					resets_at: "2026-07-18T00:00:00Z",
				},
			},
			credits: { balance: 12.5 },
		},
		"2026-07-11T12:00:00Z"
	);
	expect(snapshot).toEqual({
		provider: "codex",
		fetchedAt: "2026-07-11T12:00:00Z",
		windows: [
			{ label: "5小时窗口", usedPercent: 42, resetsAt: "2026-07-11T00:00:00Z" },
			{ label: "本周", usedPercent: 10, resetsAt: "2026-07-18T00:00:00Z" },
			{ label: "Credits", usedPercent: 0, detail: "Balance: 12.5" },
		],
	});
});

it("fetches the auth file, GETs wham/usage with both headers, and parses the reply", async () => {
	await writeFile(
		authPath,
		JSON.stringify({ tokens: { access_token: "tok", account_id: "acct" } })
	);
	const fetchImpl = vi.fn(() =>
		Promise.resolve(
			jsonResponse(200, {
				rate_limit: { primary_window: { used_percent: 5 } },
			})
		)
	);

	const snapshot = await fetchCodexQuota({
		authPath,
		fetchImpl,
		now: () => new Date("2026-07-11T12:00:00Z"),
	});

	expect(fetchImpl).toHaveBeenCalledWith(
		"https://chatgpt.com/backend-api/wham/usage",
		expect.objectContaining({
			headers: {
				Authorization: "Bearer tok",
				"ChatGPT-Account-Id": "acct",
			},
		})
	);
	expect(snapshot.windows).toEqual([
		{ label: "5小时窗口", usedPercent: 5, resetsAt: undefined },
	]);
});

it("fails open with unavailableReason when the auth file is missing", async () => {
	const fetchImpl = vi.fn();
	const snapshot = await fetchCodexQuota({ authPath, fetchImpl });
	expect(snapshot.provider).toBe("codex");
	expect(snapshot.windows).toEqual([]);
	expect(snapshot.unavailableReason).toBeDefined();
	expect(fetchImpl).not.toHaveBeenCalled();
});

it("fails open with unavailableReason when the auth file is malformed JSON", async () => {
	await writeFile(authPath, "{not json");
	const snapshot = await fetchCodexQuota({ authPath, fetchImpl: vi.fn() });
	expect(snapshot.unavailableReason).toBeDefined();
});

it("fails open with unavailableReason on a non-2xx HTTP response", async () => {
	await writeFile(
		authPath,
		JSON.stringify({ tokens: { access_token: "tok" } })
	);
	const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(401, {})));
	const snapshot = await fetchCodexQuota({ authPath, fetchImpl });
	expect(snapshot.unavailableReason).toContain("401");
});

it("fails open with unavailableReason when fetch rejects (network error)", async () => {
	await writeFile(
		authPath,
		JSON.stringify({ tokens: { access_token: "tok" } })
	);
	const fetchImpl = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
	const snapshot = await fetchCodexQuota({ authPath, fetchImpl });
	expect(snapshot.unavailableReason).toBe("ECONNREFUSED");
});

it("fails open with unavailableReason when the fetch exceeds the timeout", async () => {
	await writeFile(
		authPath,
		JSON.stringify({ tokens: { access_token: "tok" } })
	);
	const fetchImpl = vi.fn(
		(_url: string | URL | Request, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					reject(new Error("aborted"));
				});
			})
	);
	const snapshot = await fetchCodexQuota({ authPath, fetchImpl, timeoutMs: 5 });
	expect(snapshot.unavailableReason).toBeDefined();
});

import { describe, expect, it, vi } from "vitest";
import {
	CODEX_MODEL_LIST_TIMEOUT_MS,
	CODEX_STATIC_MODELS,
	fetchCodexModelList,
	type ModelListRpc,
} from "./codex-models";

function fakeRpc(request: ModelListRpc["request"]): ModelListRpc {
	return { request };
}

describe("fetchCodexModelList", () => {
	it("extracts ids from a well-formed model/list result", async () => {
		const rpc = fakeRpc((method) => {
			expect(method).toBe("model/list");
			return Promise.resolve({
				models: [{ id: "gpt-5.4" }, { id: "gpt-5.4-mini" }],
			});
		});

		await expect(fetchCodexModelList(rpc)).resolves.toEqual([
			"gpt-5.4",
			"gpt-5.4-mini",
		]);
	});

	it("falls back to model/name keys when id is absent", async () => {
		const rpc = fakeRpc(() =>
			Promise.resolve({
				models: [{ model: "gpt-5.5" }, { name: "gpt-5.3-codex" }],
			})
		);

		await expect(fetchCodexModelList(rpc)).resolves.toEqual([
			"gpt-5.5",
			"gpt-5.3-codex",
		]);
	});

	it("drops entries with no usable id rather than crashing the parse", async () => {
		const rpc = fakeRpc(() =>
			Promise.resolve({ models: [{ id: "gpt-5.4" }, { irrelevant: true }] })
		);

		await expect(fetchCodexModelList(rpc)).resolves.toEqual(["gpt-5.4"]);
	});
});

// Split from the describe block above purely to stay under the repo's
// max-lines-per-function gate (50 lines) — same `fetchCodexModelList`, just
// the three "falls back to the static list" cases.
describe("fetchCodexModelList - static fallback", () => {
	it("falls back to the static list when the RPC rejects", async () => {
		const rpc = fakeRpc(() => Promise.reject(new Error("boom")));

		await expect(fetchCodexModelList(rpc)).resolves.toEqual([
			...CODEX_STATIC_MODELS,
		]);
	});

	it("falls back to the static list when the result has no models array", async () => {
		const rpc = fakeRpc(() => Promise.resolve({}));

		await expect(fetchCodexModelList(rpc)).resolves.toEqual([
			...CODEX_STATIC_MODELS,
		]);
	});

	it("falls back to the static list when the RPC never resolves within the timeout", async () => {
		vi.useFakeTimers();
		try {
			const rpc = fakeRpc(() => new Promise(() => undefined));
			const pending = fetchCodexModelList(rpc);
			await vi.advanceTimersByTimeAsync(CODEX_MODEL_LIST_TIMEOUT_MS);
			await expect(pending).resolves.toEqual([...CODEX_STATIC_MODELS]);
		} finally {
			vi.useRealTimers();
		}
	});
});

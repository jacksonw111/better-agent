// normalizeCodexApprovalRequest — pure-function unit specs, separate from the
// adapter-level integration coverage in adapters/codex-approvals.test.ts
// (which exercises the same code wired through a fake codex RPC process).

import { describe, expect, it } from "vitest";
import { normalizeCodexApprovalRequest } from "./codex-approvals";
import type { CodexFileChangeCache } from "./codex-file-change-cache";

const REQUEST_ID = "req_1";

describe("normalizeCodexApprovalRequest - options", () => {
	it("offers accept/acceptForSession/decline as literal codex decision ids for a commandExecution request", () => {
		const [event] = normalizeCodexApprovalRequest(
			REQUEST_ID,
			"item/commandExecution/requestApproval",
			{ command: ["ls"] }
		);
		expect(event?.options).toEqual([
			{ id: "accept", label: "Allow" },
			{ id: "acceptForSession", label: "Allow for session" },
			{ id: "decline", label: "Deny" },
		]);
	});

	it("offers the same three literal ids for a fileChange request", () => {
		const [event] = normalizeCodexApprovalRequest(
			REQUEST_ID,
			"item/fileChange/requestApproval",
			{ itemId: "item_1" }
		);
		expect(event?.options).toEqual([
			{ id: "accept", label: "Allow" },
			{ id: "acceptForSession", label: "Allow for session" },
			{ id: "decline", label: "Deny" },
		]);
	});

	it("returns no events for an unrecognized method", () => {
		expect(
			normalizeCodexApprovalRequest(
				REQUEST_ID,
				"item/unknown/requestApproval",
				{}
			)
		).toEqual([]);
	});
});

describe("normalizeCodexApprovalRequest - fileChange summary", () => {
	function fakeCache(summary: string | undefined): CodexFileChangeCache {
		return {
			record: () => undefined,
			summaryFor: () => summary,
		};
	}

	it("attaches the fileChangeCache's summary for the request's itemId", () => {
		const [event] = normalizeCodexApprovalRequest(
			REQUEST_ID,
			"item/fileChange/requestApproval",
			{ itemId: "item_1" },
			fakeCache("2 files: 1 added, 1 modified (a.ts, b.ts)")
		);
		expect(event?.summary).toBe("2 files: 1 added, 1 modified (a.ts, b.ts)");
	});

	it("leaves summary undefined when no fileChangeCache is given", () => {
		const [event] = normalizeCodexApprovalRequest(
			REQUEST_ID,
			"item/fileChange/requestApproval",
			{ itemId: "item_1" }
		);
		expect(event?.summary).toBeUndefined();
	});

	it("leaves summary undefined when the cache never saw this itemId", () => {
		const [event] = normalizeCodexApprovalRequest(
			REQUEST_ID,
			"item/fileChange/requestApproval",
			{ itemId: "item_unseen" },
			fakeCache(undefined)
		);
		expect(event?.summary).toBeUndefined();
	});

	it("never attaches a summary to a commandExecution request, even with a matching cache entry", () => {
		const [event] = normalizeCodexApprovalRequest(
			REQUEST_ID,
			"item/commandExecution/requestApproval",
			{ itemId: "item_1", command: ["ls"] },
			fakeCache("2 files: 1 added, 1 modified (a.ts, b.ts)")
		);
		expect(event?.summary).toBeUndefined();
	});
});

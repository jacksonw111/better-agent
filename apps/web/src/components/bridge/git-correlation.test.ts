import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StreamEvent } from "./bridge-events";
import {
	createGitCorrelator,
	GIT_REQUEST_TIMEOUT_MS,
	GIT_TIMEOUT_MESSAGE,
} from "./git-correlation";

// P4-T4: requestId correlation for the git channel — status/commit resolve
// off their matching single reply, diff chunks reassemble out of order, and
// the inactivity timeout rejects. Mirrors fs-correlation.test.ts.

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

function setup() {
	const sent: {
		action: string;
		message?: string;
		path?: string;
		requestId: string;
	}[] = [];
	let minted = 0;
	const correlator = createGitCorrelator({
		mintId: () => {
			minted += 1;
			return `id-${minted}`;
		},
		send: {
			commit: (requestId, message) => {
				sent.push({ action: "commit", message, requestId });
				return Promise.resolve();
			},
			diff: (requestId, path) => {
				sent.push({ action: "diff", path, requestId });
				return Promise.resolve();
			},
			status: (requestId) => {
				sent.push({ action: "status", requestId });
				return Promise.resolve();
			},
		},
	});
	return { correlator, sent };
}

const CLOSED_RE = /closed/;

const statusEvent = (
	id: number,
	status: string,
	detail: unknown
): StreamEvent => ({ event: { detail, kind: "status", status }, id });

it("resolves a status from the reply matching its requestId only", async () => {
	const { correlator, sent } = setup();
	const promise = correlator.status();
	expect(sent).toEqual([{ action: "status", requestId: "id-1" }]);
	correlator.ingest([
		statusEvent(1, "git_status", { branch: "other", requestId: "not-mine" }),
		statusEvent(2, "git_status", {
			ahead: 2,
			branch: "main",
			entries: [{ path: "a.ts", x: "M", y: " " }],
			requestId: "id-1",
			truncated: false,
		}),
	]);
	await expect(promise).resolves.toEqual({
		ahead: 2,
		behind: undefined,
		branch: "main",
		entries: [{ path: "a.ts", x: "M", y: " " }],
		notARepo: false,
		truncated: false,
	});
});

it("resolves a not-a-repo status reply with the flag set", async () => {
	const { correlator } = setup();
	const promise = correlator.status();
	correlator.ingest([
		statusEvent(1, "git_status", { notARepo: true, requestId: "id-1" }),
	]);
	await expect(promise).resolves.toMatchObject({
		entries: [],
		notARepo: true,
	});
});

it("reassembles diff chunks arriving out of order", async () => {
	const { correlator, sent } = setup();
	const promise = correlator.diff("src/a.ts");
	expect(sent).toEqual([
		{ action: "diff", path: "src/a.ts", requestId: "id-1" },
	]);
	const chunk = (chunkIndex: number, content: string, done: boolean) =>
		statusEvent(chunkIndex + 1, "git_diff", {
			chunkIndex,
			content,
			done,
			requestId: "id-1",
			totalChunks: 2,
			truncated: true,
		});
	correlator.ingest([chunk(1, "-old\n", true)]);
	correlator.ingest([chunk(0, "+new\n", false)]);
	await expect(promise).resolves.toEqual({
		content: "+new\n-old\n",
		truncated: true,
	});
});

it("resolves a commit ok reply with its hash and rejects an error reply", async () => {
	const { correlator, sent } = setup();
	const ok = correlator.commit("feat: x");
	expect(sent).toEqual([
		{ action: "commit", message: "feat: x", requestId: "id-1" },
	]);
	correlator.ingest([
		statusEvent(1, "git_commit", {
			hash: "abc1234",
			ok: true,
			requestId: "id-1",
		}),
	]);
	await expect(ok).resolves.toEqual({ hash: "abc1234" });

	const failing = correlator.commit("feat: y");
	correlator.ingest([
		statusEvent(2, "git_commit", {
			error: "nothing to commit",
			requestId: "id-2",
		}),
	]);
	await expect(failing).rejects.toThrow("nothing to commit");
});

it("rejects after the timeout when no reply ever arrives", async () => {
	const { correlator } = setup();
	const promise = correlator.status();
	const rejection = expect(promise).rejects.toThrow(GIT_TIMEOUT_MESSAGE);
	vi.advanceTimersByTime(GIT_REQUEST_TIMEOUT_MS + 1);
	await rejection;
});

it("rejects everything pending on dispose", async () => {
	const { correlator } = setup();
	const status = correlator.status();
	const diff = correlator.diff();
	const commit = correlator.commit("m");
	const rejections = Promise.all([
		expect(status).rejects.toThrow(CLOSED_RE),
		expect(diff).rejects.toThrow(CLOSED_RE),
		expect(commit).rejects.toThrow(CLOSED_RE),
	]);
	correlator.dispose();
	await rejections;
});

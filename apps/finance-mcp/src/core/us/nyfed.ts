import { fetchWithRetry } from "../http";
import type { CbOp } from "../types";

// NY Fed temporary open-market operations (repo / reverse repo).
// NOTE: the historical `/api/rp/all/latest.json` path returned HTTP 400 from the
// NY Fed Markets API (the `rp` resource had moved). This endpoint is confirmed
// working (last ~2 weeks of repo/reverse-repo operations). This connector still
// degrades gracefully to [] on any failure rather than surfacing an upstream
// error to the tool/REST caller.
const NYFED_URL =
	"https://markets.newyorkfed.org/api/rp/all/all/results/lastTwoWeeks.json";

interface RpOp {
	operationDate?: string;
	operationType?: string;
	totalAmtAccepted?: number;
}

export async function fedOps(
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<CbOp[]> {
	try {
		const res = await fetchWithRetry(NYFED_URL, undefined, {
			fetchImpl: opts.fetchImpl,
			signal: opts.signal,
		});
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as { repo?: { operations?: RpOp[] } };
		const ops = json.repo?.operations ?? [];
		return ops
			.filter((o): o is RpOp & { operationDate: string } =>
				Boolean(o.operationDate)
			)
			.map((o) => ({
				date: o.operationDate,
				type: o.operationType ?? "repo",
				amount: o.totalAmtAccepted,
			}));
	} catch {
		return [];
	}
}

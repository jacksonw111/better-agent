import type { CbOp } from "../types";

// NY Fed temporary open-market operations (repo / reverse repo).
// NOTE: the historical `/api/rp/all/latest.json` path now returns HTTP 400 from
// the NY Fed Markets API (the `rp` resource appears to have moved; `rates`/`soma`
// still respond). Reconfirming the correct repo-operations endpoint is a v2 task.
// Until then this connector degrades gracefully to [] on any failure rather than
// surfacing an upstream error to the tool/REST caller.
const NYFED_URL = "https://markets.newyorkfed.org/api/rp/all/latest.json";

interface RpOp {
	operationDate?: string;
	operationType?: string;
	totalAmtAccepted?: number;
}

export async function fedOps(
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<CbOp[]> {
	const doFetch = opts.fetchImpl ?? fetch;
	try {
		const res = await doFetch(NYFED_URL, { signal: opts.signal });
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

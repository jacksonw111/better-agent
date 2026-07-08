import type { CbOp } from "../types";

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
	const res = await doFetch(NYFED_URL, { signal: opts.signal });
	if (!res.ok) {
		throw new Error(`nyfed HTTP ${res.status}`);
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
}

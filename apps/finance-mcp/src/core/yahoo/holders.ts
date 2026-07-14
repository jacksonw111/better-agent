// Institutional ownership via Yahoo quoteSummary: insider/institution
// percentage overview plus the top-10 institutional holders.
import { rawNum, yahooQuoteSummary } from "./session";

interface FetchOpts {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}

export interface HoldersOverview {
	insidersPct: number | null;
	institutionsCount: number | null;
	institutionsFloatPct: number | null;
	institutionsPct: number | null;
}

export interface TopHolderRow {
	name: string;
	pctHeld: number | null;
	reportDate: string;
	shares: number | null;
	value: number | null;
}

export interface InstitutionalHolders {
	overview: HoldersOverview;
	topHolders: TopHolderRow[];
}

const QUOTE_SUMMARY_MODULES = ["institutionOwnership", "majorHoldersBreakdown"];
const TOP_HOLDERS_CAP = 10;

function asRecord(value: unknown): Record<string, unknown> {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function asRecords(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((entry) => asRecord(entry));
}

// reportDate arrives as {raw, fmt} — the fmt ("YYYY-MM-DD") is what we want.
function fmtString(value: unknown): string {
	const record = asRecord(value);
	return typeof record.fmt === "string" ? record.fmt : "";
}

function toOverview(breakdown: Record<string, unknown>): HoldersOverview {
	return {
		insidersPct: rawNum(breakdown.insidersPercentHeld),
		institutionsPct: rawNum(breakdown.institutionsPercentHeld),
		institutionsFloatPct: rawNum(breakdown.institutionsFloatPercentHeld),
		institutionsCount: rawNum(breakdown.institutionsCount),
	};
}

function toTopHolderRow(holder: Record<string, unknown>): TopHolderRow {
	return {
		name: typeof holder.organization === "string" ? holder.organization : "",
		shares: rawNum(holder.position),
		value: rawNum(holder.value),
		pctHeld: rawNum(holder.pctHeld),
		reportDate: fmtString(holder.reportDate),
	};
}

export async function getInstitutionalHolders(
	symbol: string,
	opts: FetchOpts = {}
): Promise<InstitutionalHolders | null> {
	const summary = await yahooQuoteSummary(symbol, QUOTE_SUMMARY_MODULES, opts);
	if (!summary) {
		return null;
	}
	const breakdown = asRecord(summary.majorHoldersBreakdown);
	const ownership = asRecords(
		asRecord(summary.institutionOwnership).ownershipList
	).slice(0, TOP_HOLDERS_CAP);
	return {
		overview: toOverview(breakdown),
		topHolders: ownership.map(toTopHolderRow),
	};
}

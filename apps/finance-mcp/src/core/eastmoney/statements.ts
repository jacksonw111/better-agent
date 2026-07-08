import { fetchWithRetry } from "../http";
import type { StatementRow, StatementType } from "../types";
import { secucode } from "./secucode";

const EM_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const DATE_LENGTH = 10;
const DEFAULT_PERIODS = 4;
const MAX_PERIODS = 20;

const REPORT_NAMES: Record<StatementType, string> = {
	income: "RPT_DMSK_FN_INCOME",
	balance: "RPT_DMSK_FN_BALANCE",
	cashflow: "RPT_DMSK_FN_CASHFLOW",
};

interface RawRow {
	CCE_ADD?: number | null;
	DEBT_ASSET_RATIO?: number | null;
	DEDUCT_PARENT_NETPROFIT?: number | null;
	MONETARYFUNDS?: number | null;
	NETCASH_FINANCE?: number | null;
	NETCASH_INVEST?: number | null;
	NETCASH_OPERATE?: number | null;
	OPERATE_COST?: number | null;
	OPERATE_PROFIT?: number | null;
	PARENT_NETPROFIT?: number | null;
	REPORT_DATE?: string | null;
	TOTAL_ASSETS?: number | null;
	TOTAL_EQUITY?: number | null;
	TOTAL_LIABILITIES?: number | null;
	TOTAL_OPERATE_INCOME?: number | null;
	TOTAL_PROFIT?: number | null;
}

export function normalizeStatement(statement: string): StatementType {
	if (statement === "balance" || statement === "cashflow") {
		return statement;
	}
	return "income";
}

function clampPeriods(periods: number): number {
	if (!Number.isFinite(periods) || periods <= 0) {
		return DEFAULT_PERIODS;
	}
	return Math.min(Math.floor(periods), MAX_PERIODS);
}

function toIncomeRow(r: RawRow, reportDate: string): StatementRow {
	return {
		reportDate,
		revenue: r.TOTAL_OPERATE_INCOME ?? null,
		operatingCost: r.OPERATE_COST ?? null,
		operatingProfit: r.OPERATE_PROFIT ?? null,
		totalProfit: r.TOTAL_PROFIT ?? null,
		netProfit: r.PARENT_NETPROFIT ?? null,
		netProfitDeducted: r.DEDUCT_PARENT_NETPROFIT ?? null,
	};
}

function toBalanceRow(r: RawRow, reportDate: string): StatementRow {
	return {
		reportDate,
		totalAssets: r.TOTAL_ASSETS ?? null,
		totalLiabilities: r.TOTAL_LIABILITIES ?? null,
		totalEquity: r.TOTAL_EQUITY ?? null,
		cash: r.MONETARYFUNDS ?? null,
		debtRatio: r.DEBT_ASSET_RATIO ?? null,
	};
}

function toCashflowRow(r: RawRow, reportDate: string): StatementRow {
	return {
		reportDate,
		operatingCashflow: r.NETCASH_OPERATE ?? null,
		investingCashflow: r.NETCASH_INVEST ?? null,
		financingCashflow: r.NETCASH_FINANCE ?? null,
		netCashChange: r.CCE_ADD ?? null,
	};
}

function toRow(statement: StatementType, r: RawRow): StatementRow {
	const reportDate = r.REPORT_DATE ? r.REPORT_DATE.slice(0, DATE_LENGTH) : "";
	if (statement === "balance") {
		return toBalanceRow(r, reportDate);
	}
	if (statement === "cashflow") {
		return toCashflowRow(r, reportDate);
	}
	return toIncomeRow(r, reportDate);
}

export async function getStatements(
	symbol: string,
	statement: string,
	periods: number,
	opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<StatementRow[]> {
	const { secucode: code } = secucode(symbol);
	const type = normalizeStatement(statement);
	const size = clampPeriods(periods);
	const url =
		`${EM_URL}?reportName=${REPORT_NAMES[type]}&columns=ALL` +
		`&filter=(SECUCODE="${code}")&pageSize=${size}&pageNumber=1` +
		"&sortColumns=REPORT_DATE&sortTypes=-1";
	try {
		const res = await fetchWithRetry(
			url,
			{ headers: { Referer: "https://data.eastmoney.com/" } },
			{ fetchImpl: opts.fetchImpl, signal: opts.signal }
		);
		if (!res.ok) {
			return [];
		}
		const json = (await res.json()) as {
			result?: { data?: RawRow[] } | null;
		};
		const rows = json.result?.data ?? [];
		return rows.map((r) => toRow(type, r));
	} catch {
		return [];
	}
}

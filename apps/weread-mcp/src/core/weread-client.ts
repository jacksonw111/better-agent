export const SKILL_VERSION = "1.0.4";
const GATEWAY = "https://i.weread.qq.com/api/agent/gateway";

export class WereadApiError extends Error {}

export class NotConfiguredError extends WereadApiError {
	constructor() {
		super(
			"WeRead API key required: pass it via the x-weread-key header (or set WEREAD_API_KEY)"
		);
	}
}

interface GatewayResponse {
	errcode?: number;
	errmsg?: string;
	upgrade_info?: { message?: string };
	[key: string]: unknown;
}

export async function wereadCall(
	apiKey: string,
	apiName: string,
	params: Record<string, unknown>,
	fetchImpl: typeof fetch = fetch
): Promise<GatewayResponse> {
	const body = {
		api_name: apiName,
		...params,
		skill_version: SKILL_VERSION,
	};
	const res = await fetchImpl(GATEWAY, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		throw new WereadApiError(`WeRead gateway HTTP ${res.status}`);
	}
	const json = (await res.json()) as GatewayResponse;
	if (json.errcode && json.errcode !== 0) {
		throw new WereadApiError(json.errmsg ?? `WeRead errcode ${json.errcode}`);
	}
	return json;
}

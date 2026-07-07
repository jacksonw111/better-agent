export class XError extends Error {
	override readonly name: string = "XError";
	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
	}
}

export class XAuthError extends XError {
	// 401/403 → token disabled
	override readonly name: string = "XAuthError";
}

export class XRateLimitError extends XError {
	// 429 → token cooling 15min
	override readonly name: string = "XRateLimitError";
}

export class XNotFoundError extends XError {
	// 404 → 账号侧问题，不罚 token
	override readonly name: string = "XNotFoundError";
}

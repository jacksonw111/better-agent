// Shared resilient HTTP layer used by every upstream connector: automatic
// retry on transient failures (429/5xx/network errors) plus a per-request
// timeout. Non-retryable statuses (e.g. 400/404) are returned as-is — the
// caller decides what to do with them.

export interface HttpOpts {
	backoffBaseMs?: number;
	fetchImpl?: typeof fetch;
	retries?: number;
	signal?: AbortSignal;
	timeoutMs?: number;
}

const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_BACKOFF_BASE_MS = 200;

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_GATEWAY_TIMEOUT = 504;
const RETRYABLE_STATUSES = new Set([
	HTTP_TOO_MANY_REQUESTS,
	HTTP_INTERNAL_SERVER_ERROR,
	HTTP_BAD_GATEWAY,
	HTTP_SERVICE_UNAVAILABLE,
	HTTP_GATEWAY_TIMEOUT,
]);

const MS_PER_SECOND = 1000;
const MAX_RETRY_AFTER_MS = 5000;
const BACKOFF_EXPONENT_BASE = 2;

function isRetryableStatus(status: number): boolean {
	return RETRYABLE_STATUSES.has(status);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(base: number, attemptIndex: number): number {
	return base * BACKOFF_EXPONENT_BASE ** attemptIndex;
}

// Reads a numeric `Retry-After` (seconds) header, capped at MAX_RETRY_AFTER_MS.
function retryAfterMs(res: Response): number | null {
	const header = res.headers.get("Retry-After");
	if (!header) {
		return null;
	}
	const seconds = Number(header);
	if (!Number.isFinite(seconds)) {
		return null;
	}
	return Math.min(seconds * MS_PER_SECOND, MAX_RETRY_AFTER_MS);
}

function waitMsFor(
	res: Response,
	backoffBase: number,
	attemptIndex: number
): number {
	if (res.status === HTTP_TOO_MANY_REQUESTS) {
		const retryAfter = retryAfterMs(res);
		if (retryAfter !== null) {
			return retryAfter;
		}
	}
	return backoffMs(backoffBase, attemptIndex);
}

function combineSignals(
	timeoutSignal: AbortSignal,
	callerSignal: AbortSignal | undefined
): AbortSignal {
	if (!callerSignal) {
		return timeoutSignal;
	}
	if (typeof AbortSignal.any === "function") {
		return AbortSignal.any([timeoutSignal, callerSignal]);
	}
	return timeoutSignal;
}

interface ResolvedHttpOpts {
	backoffBase: number;
	doFetch: typeof fetch;
	maxAttempts: number;
	timeoutMs: number;
}

function resolveOpts(opts: HttpOpts): ResolvedHttpOpts {
	return {
		doFetch: opts.fetchImpl ?? fetch,
		maxAttempts: (opts.retries ?? DEFAULT_RETRIES) + 1,
		timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		backoffBase: opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
	};
}

// A deliberate caller cancellation must propagate immediately, never retried.
function isCallerAbort(callerSignal: AbortSignal | undefined): boolean {
	return callerSignal?.aborted ?? false;
}

function shouldRetryStatus(status: number, hasMoreAttempts: boolean): boolean {
	return isRetryableStatus(status) && hasMoreAttempts;
}

export async function fetchWithRetry(
	url: string,
	init: RequestInit = {},
	opts: HttpOpts = {}
): Promise<Response> {
	const { doFetch, maxAttempts, timeoutMs, backoffBase } = resolveOpts(opts);

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const hasMoreAttempts = attempt < maxAttempts - 1;
		const combinedSignal = combineSignals(
			AbortSignal.timeout(timeoutMs),
			opts.signal
		);
		try {
			const res = await doFetch(url, { ...init, signal: combinedSignal });
			if (shouldRetryStatus(res.status, hasMoreAttempts)) {
				await delay(waitMsFor(res, backoffBase, attempt));
				continue;
			}
			return res;
		} catch (err) {
			if (isCallerAbort(opts.signal) || !hasMoreAttempts) {
				throw err;
			}
			await delay(backoffMs(backoffBase, attempt));
		}
	}
	// Unreachable: the loop above always returns or throws within maxAttempts.
	throw new Error("fetchWithRetry: exhausted attempts");
}

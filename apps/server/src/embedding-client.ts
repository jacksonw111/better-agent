import type { EmbeddingClient } from "@better-agent/agent/ports";
import { env } from "@better-agent/env/server";

// Memory embeddings via SiliconFlow's OpenAI-compatible embeddings API. NOTE:
// despite decision D1 ("Cloudflare Workers AI, read path on-edge"), we call an
// EXTERNAL API from Node — the read path is NOT on-edge. `Pro/BAAI/bge-m3`
// emits 1024-dim vectors, matching the `vector(1024)` column. The response is
// `{ data: [{ embedding: number[] }] }`; we parse it defensively so a
// shape/length change surfaces as a clear error rather than a silently bad
// vector. Transient failures (429/5xx/network/timeout) are retried with
// exponential backoff + jitter, honoring Retry-After. The API key is env-only
// (never committed); a missing key throws on first call rather than at boot, so
// the rest of the server runs without embeddings configured.

const DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_MODEL = "Pro/BAAI/bge-m3";
const EMBEDDING_DIMENSIONS = 1024;
// Cap on how much upstream error text is echoed back, so a huge body can't
// bloat the thrown message.
const MAX_ERROR_DETAIL = 200;

// Retry policy: 1 initial + up to 3 retries, full-jitter exponential backoff
// capped at MAX_DELAY_MS. Only transient statuses are retried; 4xx like 400/401
// won't recover on retry, so they fail fast.
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 300;
const MAX_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

interface EmbeddingResponse {
	data?: Array<{ embedding?: unknown }>;
}

// A retryable transient failure. Absence of this shape (e.g. a bad-response-body
// Error) is treated as non-retryable — a wrong shape won't change on retry.
interface TransientError extends Error {
	retryAfterMs: number | null;
	retryable: true;
}

function transientError(
	message: string,
	retryAfterMs: number | null
): TransientError {
	const error = new Error(message) as TransientError;
	error.retryable = true;
	error.retryAfterMs = retryAfterMs;
	return error;
}

function isTransient(error: unknown): error is TransientError {
	return (error as Partial<TransientError> | null)?.retryable === true;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retry-After may be a delay in seconds or an HTTP date; null if absent/unparsable.
function parseRetryAfter(header: string | null): number | null {
	if (!header) {
		return null;
	}
	const seconds = Number(header);
	if (Number.isFinite(seconds)) {
		return Math.max(0, seconds * 1000);
	}
	const at = Date.parse(header);
	return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function backoffDelay(attempt: number, retryAfterMs: number | null): number {
	if (retryAfterMs !== null) {
		return Math.min(retryAfterMs, MAX_DELAY_MS);
	}
	const capped = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
	// Full jitter: uniformly random in [capped/2, capped] to avoid thundering herd.
	return Math.round(capped * (0.5 + Math.random() * 0.5));
}

function extractVector(body: EmbeddingResponse): number[] {
	const first = body.data?.[0]?.embedding;
	if (
		!Array.isArray(first) ||
		first.length !== EMBEDDING_DIMENSIONS ||
		first.some((value) => typeof value !== "number")
	) {
		throw new Error(
			`SiliconFlow returned an unexpected embedding shape (expected ${EMBEDDING_DIMENSIONS} numbers)`
		);
	}
	return first as number[];
}

// One HTTP attempt. Throws a TransientError for retryable conditions
// (network/timeout/429/5xx) and a plain Error for permanent ones (4xx, bad shape).
async function attemptEmbedding(
	apiKey: string,
	baseUrl: string,
	model: string,
	text: string
): Promise<number[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetch(`${baseUrl}/embeddings`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ model, input: text }),
			signal: controller.signal,
		});
	} catch (cause) {
		// Network error or the timeout abort — both are worth retrying.
		const reason = cause instanceof Error ? cause.message : String(cause);
		throw transientError(
			`SiliconFlow embedding request failed: ${reason}`,
			null
		);
	} finally {
		clearTimeout(timer);
	}
	if (!response.ok) {
		const detail = (await response.text().catch(() => "")).slice(
			0,
			MAX_ERROR_DETAIL
		);
		const message = `SiliconFlow embedding failed (${response.status}): ${detail}`;
		if (RETRYABLE_STATUSES.has(response.status)) {
			throw transientError(
				message,
				parseRetryAfter(response.headers.get("retry-after"))
			);
		}
		throw new Error(message);
	}
	const body = (await response.json()) as EmbeddingResponse;
	return extractVector(body);
}

async function requestEmbedding(
	apiKey: string,
	baseUrl: string,
	model: string,
	text: string
): Promise<number[]> {
	let lastError: unknown;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		try {
			return await attemptEmbedding(apiKey, baseUrl, model, text);
		} catch (error) {
			lastError = error;
			if (!isTransient(error) || attempt === MAX_ATTEMPTS - 1) {
				throw error;
			}
			await sleep(backoffDelay(attempt, error.retryAfterMs));
		}
	}
	// Unreachable: the loop either returns or throws on the final attempt.
	throw lastError;
}

/** The SiliconFlow embedding client. Always returned (so the memory feature is
 * wired), but `embed` throws if `SILICONFLOW_API_KEY` is unset — keeping the key
 * env-only and surfacing misconfiguration loudly at call time. */
export function buildEmbeddingClient(): EmbeddingClient {
	const baseUrl = env.SILICONFLOW_BASE_URL ?? DEFAULT_BASE_URL;
	const model = env.EMBEDDING_MODEL ?? DEFAULT_MODEL;
	return {
		model,
		embed(text: string): Promise<number[]> {
			const apiKey = env.SILICONFLOW_API_KEY;
			if (!apiKey) {
				return Promise.reject(new Error("SILICONFLOW_API_KEY not set"));
			}
			return requestEmbedding(apiKey, baseUrl, model, text);
		},
	};
}

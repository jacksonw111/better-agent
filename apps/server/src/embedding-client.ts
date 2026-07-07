import type { EmbeddingClient } from "@better-agent/agent/ports";
import { env } from "@better-agent/env/server";

// Memory embeddings via SiliconFlow's OpenAI-compatible embeddings API
// (decision D1). `BAAI/bge-m3` emits 1024-dim vectors, matching the
// `vector(1024)` column. The response is `{ data: [{ embedding: number[] }] }`;
// we parse it defensively so a shape/length change surfaces as a clear error
// rather than a silently bad vector. The API key is env-only (never committed);
// a missing key throws on first call rather than at boot, so the rest of the
// server runs without embeddings configured.

const DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_MODEL = "BAAI/bge-m3";
const EMBEDDING_DIMENSIONS = 1024;
// Cap on how much upstream error text is echoed back, so a huge body can't
// bloat the thrown message.
const MAX_ERROR_DETAIL = 200;

interface EmbeddingResponse {
	data?: Array<{ embedding?: unknown }>;
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

async function requestEmbedding(
	apiKey: string,
	baseUrl: string,
	model: string,
	text: string
): Promise<number[]> {
	const response = await fetch(`${baseUrl}/embeddings`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ model, input: text }),
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(
			`SiliconFlow embedding failed (${response.status}): ${detail.slice(0, MAX_ERROR_DETAIL)}`
		);
	}
	const body = (await response.json()) as EmbeddingResponse;
	return extractVector(body);
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

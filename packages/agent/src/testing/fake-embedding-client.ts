import type { EmbeddingClient } from "../memory-ports";

// A deterministic, dependency-free EmbeddingClient for tests: identical text
// always maps to the identical 1024-vector, so kNN over the fake is stable and
// a query equal to an item's content lands that item at cosine distance 0 (its
// nearest neighbour). Not semantically meaningful — only reproducible. Uses
// plain modular + trig arithmetic (no bitwise) so it stays lint-clean.

const EMBEDDING_DIMENSIONS = 1024;
const FAKE_MODEL = "fake-bge-m3-1024";
// A large prime keeps the rolling string hash bounded well under 2^53.
const HASH_MODULUS = 1_000_000_007;
const HASH_MULTIPLIER = 31;
// Classic fract(sin(x) * C) value hash — deterministic per (seed, index).
const SINE_FREQ = 12.9898;
const SINE_SCALE = 43_758.5453;
// Maps a [0, 1) fraction onto [-1, 1): fraction * SPAN - 1.
const UNIT_SPAN = 2;

function hashText(text: string): number {
	let seed = 0;
	for (let i = 0; i < text.length; i++) {
		seed = (seed * HASH_MULTIPLIER + text.charCodeAt(i)) % HASH_MODULUS;
	}
	return seed + 1;
}

// A deterministic pseudo-random value in [-1, 1] from a seed and dimension.
function componentAt(seed: number, index: number): number {
	const raw = Math.sin(seed * (index + 1) * SINE_FREQ) * SINE_SCALE;
	const fraction = raw - Math.floor(raw);
	return fraction * UNIT_SPAN - 1;
}

export function createFakeEmbeddingClient(): EmbeddingClient {
	return {
		model: FAKE_MODEL,
		embed(text: string): Promise<number[]> {
			const seed = hashText(text);
			const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
				componentAt(seed, index)
			);
			return Promise.resolve(vector);
		},
	};
}

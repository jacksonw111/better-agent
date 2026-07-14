// biome-ignore-all lint/suspicious/noBitwiseOperators: MD5 is defined in terms of 32-bit bitwise arithmetic (RFC 1321); every shift/rotate/mask here is intentional.
// Pure-TypeScript MD5 (RFC 1321), hex output. Needed because Workers'
// crypto.subtle does not implement MD5 (it is not a WebCrypto algorithm),
// yet cls.cn's request signature requires md5(sha1(qs)).

const BLOCK_BYTES = 64;
const LENGTH_FIELD_BYTES = 8;
const PADDING_MARKER = 0x80;
const WORDS_PER_BLOCK = 16;
const ROUNDS = 64;
const BITS_PER_BYTE = 8;
const UINT32_SPAN = 2 ** 32;
const HEX_PAD = 8;

// Per-round left-rotate amounts (RFC 1321 §3.4).
const SHIFTS = [
	7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
	9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
	16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
	21,
] as const;

// K[i] = floor(|sin(i + 1)| * 2^32) — the RFC's sine-derived constants.
const K = new Uint32Array(ROUNDS);
for (let i = 0; i < ROUNDS; i++) {
	K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * UINT32_SPAN);
}

const INIT_A = 0x67_45_23_01;
const INIT_B = 0xef_cd_ab_89;
const INIT_C = 0x98_ba_dc_fe;
const INIT_D = 0x10_32_54_76;

function rotl(x: number, n: number): number {
	return ((x << n) | (x >>> (32 - n))) >>> 0;
}

// Pads the UTF-8 message per RFC 1321: 0x80, zeros, then the original bit
// length as a 64-bit little-endian integer.
function padMessage(bytes: Uint8Array): Uint8Array {
	const bitLen = bytes.length * BITS_PER_BYTE;
	const paddedLen =
		Math.ceil((bytes.length + 1 + LENGTH_FIELD_BYTES) / BLOCK_BYTES) *
		BLOCK_BYTES;
	const out = new Uint8Array(paddedLen);
	out.set(bytes);
	out[bytes.length] = PADDING_MARKER;
	const view = new DataView(out.buffer);
	view.setUint32(paddedLen - LENGTH_FIELD_BYTES, bitLen >>> 0, true);
	view.setUint32(
		paddedLen - LENGTH_FIELD_BYTES + 4,
		bitLen / UINT32_SPAN,
		true
	);
	return out;
}

function roundValues(
	round: number,
	b: number,
	c: number,
	d: number,
	i: number
): { f: number; g: number } {
	if (round === 0) {
		return { f: (b & c) | (~b & d), g: i };
	}
	if (round === 1) {
		return { f: (d & b) | (~d & c), g: (5 * i + 1) % WORDS_PER_BLOCK };
	}
	if (round === 2) {
		return { f: b ^ c ^ d, g: (3 * i + 5) % WORDS_PER_BLOCK };
	}
	return { f: c ^ (b | ~d), g: (7 * i) % WORDS_PER_BLOCK };
}

function toLeHex(word: number): string {
	// Little-endian byte order in the hex digest.
	const be = word.toString(16).padStart(HEX_PAD, "0");
	return `${be.slice(6, 8)}${be.slice(4, 6)}${be.slice(2, 4)}${be.slice(0, 2)}`;
}

export function md5Hex(input: string): string {
	const padded = padMessage(new TextEncoder().encode(input));
	const view = new DataView(padded.buffer);
	let a0 = INIT_A;
	let b0 = INIT_B;
	let c0 = INIT_C;
	let d0 = INIT_D;

	for (let block = 0; block < padded.length; block += BLOCK_BYTES) {
		const m = new Uint32Array(WORDS_PER_BLOCK);
		for (let w = 0; w < WORDS_PER_BLOCK; w++) {
			m[w] = view.getUint32(block + w * 4, true);
		}
		let a = a0;
		let b = b0;
		let c = c0;
		let d = d0;
		for (let i = 0; i < ROUNDS; i++) {
			const round = Math.floor(i / WORDS_PER_BLOCK);
			const { f, g } = roundValues(round, b, c, d, i);
			const sum = (f + a + (K[i] ?? 0) + (m[g] ?? 0)) >>> 0;
			a = d;
			d = c;
			c = b;
			b = (b + rotl(sum, SHIFTS[i] ?? 0)) >>> 0;
		}
		a0 = (a0 + a) >>> 0;
		b0 = (b0 + b) >>> 0;
		c0 = (c0 + c) >>> 0;
		d0 = (d0 + d) >>> 0;
	}
	return toLeHex(a0) + toLeHex(b0) + toLeHex(c0) + toLeHex(d0);
}

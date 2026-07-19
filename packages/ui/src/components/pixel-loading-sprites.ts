// Pixel data for the platformer loading animation (pixel-loading.tsx).
// Original sprites in the spirit of a classic 8-bit level 1-1 — no ripped
// assets. Characters index into the palette: "." = transparent.

export interface PixelPalette {
	block: string;
	blockDark: string;
	brick: string;
	brickDark: string;
	castle: string;
	cloud: string;
	coin: string;
	flag: string;
	hill: string;
	hillDark: string;
	pipe: string;
	pipeDark: string;
	pole: string;
	sky: string;
	star: string;
}

/** Classic sunny overworld. */
export const DAY_PALETTE: PixelPalette = {
	sky: "#5c94fc",
	cloud: "#fcfcfc",
	hill: "#00a800",
	hillDark: "#007000",
	brick: "#c84c0c",
	brickDark: "#883000",
	block: "#e8a018",
	blockDark: "#a05000",
	pipe: "#00b800",
	pipeDark: "#006800",
	flag: "#00a800",
	pole: "#b0b0b0",
	castle: "#9c4a00",
	coin: "#fcd000",
	star: "#fcfcfc",
};

/** Night variant for dark mode: same level, moonlit. */
export const NIGHT_PALETTE: PixelPalette = {
	sky: "#101830",
	cloud: "#8890b0",
	hill: "#0c5c2c",
	hillDark: "#083c1c",
	brick: "#8c3808",
	brickDark: "#5c2404",
	block: "#c08014",
	blockDark: "#784000",
	pipe: "#00883c",
	pipeDark: "#00542a",
	flag: "#00883c",
	pole: "#787888",
	castle: "#6c3400",
	coin: "#e8bc10",
	star: "#e8e8f8",
};

/** Sprite-char → color. The runner is an original little adventurer:
 * r = cap/shirt, s = skin, b = overalls, k = boots/eyes, y = buckle. */
export const SPRITE_COLORS: Record<string, string> = {
	r: "#d82800",
	s: "#fcb890",
	b: "#2848c8",
	k: "#201810",
	y: "#fcd000",
};

export const RUNNER_RUN_1 = [
	"...rrrr...",
	"..rrrrrr..",
	"..sskss...",
	"..ssssss..",
	"...ssss...",
	"..rbbbbr..",
	".rrbyybrr.",
	".ssbbbbss.",
	"..bbbbbb..",
	"..bb..bb..",
	".kkk..bb..",
	"......kkk.",
];

export const RUNNER_RUN_2 = [
	"...rrrr...",
	"..rrrrrr..",
	"..sskss...",
	"..ssssss..",
	"...ssss...",
	"..rbbbbr..",
	".rrbyybrr.",
	".ssbbbbss.",
	"..bbbbbb..",
	"...bbbb...",
	"...bbbb...",
	"..kk..kk..",
];

export const RUNNER_JUMP = [
	"...rrrr...",
	"..rrrrrr..",
	"..sskss...",
	"..ssssss..",
	"ss.ssss.ss",
	"srrbbbbrrs",
	".rrbyybrr.",
	"..bbbbbb..",
	"..bb..bb..",
	".bb....bb.",
	".kk....kk.",
	"..........",
];

/** Draws one string-array sprite at (x, y), 1 grid cell = 1 canvas px. */
export function drawSprite(
	ctx: CanvasRenderingContext2D,
	sprite: string[],
	x: number,
	y: number
): void {
	for (let row = 0; row < sprite.length; row++) {
		const line = sprite[row] ?? "";
		for (let col = 0; col < line.length; col++) {
			const color = SPRITE_COLORS[line[col] ?? "."];
			if (color) {
				ctx.fillStyle = color;
				ctx.fillRect(x + col, y + row, 1, 1);
			}
		}
	}
}

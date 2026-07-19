// Pixel data for the platformer loading animation (pixel-loading.tsx).
// The hero is a 12x16 classic plumber — red cap, mustache, blue overalls —
// drawn by hand here (not a ripped sprite sheet). Characters index into
// SPRITE_COLORS: "." = transparent.

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

/** Sprite-char → color: r = cap/shirt red, s = skin, m = hair/mustache brown,
 * b = overalls blue, y = buttons, k = eyes/boots. */
export const SPRITE_COLORS: Record<string, string> = {
	r: "#d82800",
	s: "#fcb890",
	m: "#5c2e0c",
	b: "#2848c8",
	k: "#201810",
	y: "#fcd000",
};

export const RUNNER_HEIGHT = 16;

// Facing right; cap bill and mustache point in the running direction.
export const RUNNER_RUN_1 = [
	"...rrrrrr...",
	"..rrrrrrrrr.",
	"..mmmsssss..",
	".mmsmsssks..",
	".mmsmssssss.",
	".msssssmmm..",
	"...ssssss...",
	"..rrrrrr....",
	".rrrrbbrrr..",
	".rrbbbbbbrr.",
	".ssbybbybss.",
	"..sbbbbbbs..",
	"..bbbbbbbb..",
	"..bbb..bbb..",
	".kkkk...bbb.",
	".........kkk",
];

export const RUNNER_RUN_2 = [
	"...rrrrrr...",
	"..rrrrrrrrr.",
	"..mmmsssss..",
	".mmsmsssks..",
	".mmsmssssss.",
	".msssssmmm..",
	"...ssssss...",
	"..rrrrrr....",
	".rrrrbbrrr..",
	".rrbbbbbbrr.",
	".ssbybbybss.",
	"..sbbbbbbs..",
	"..bbbbbbbb..",
	"...bbbbbb...",
	"...bb..bb...",
	"..kkk..kkk..",
];

export const RUNNER_JUMP = [
	"...rrrrrr.ss",
	"..rrrrrrrrss",
	"..mmmsssss..",
	".mmsmsssks..",
	".mmsmssssss.",
	".msssssmmm..",
	"...ssssss...",
	".srrrrrr....",
	"ssrrrbbrrr..",
	".srbbbbbbr..",
	"..bbybbyb...",
	"..bbbbbbbb..",
	"..bbbbbbbb..",
	".bbb....bbb.",
	".kkk....kkk.",
	"............",
];

// Each sprite rasterizes to an offscreen canvas once; every animation frame
// after that is a single drawImage instead of ~150 fillRects.
const spriteCache = new Map<string[], HTMLCanvasElement>();

function rasterize(sprite: string[]): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = sprite[0]?.length ?? 0;
	canvas.height = sprite.length;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return canvas;
	}
	for (let row = 0; row < sprite.length; row++) {
		const line = sprite[row] ?? "";
		for (let col = 0; col < line.length; col++) {
			const color = SPRITE_COLORS[line[col] ?? "."];
			if (color) {
				ctx.fillStyle = color;
				ctx.fillRect(col, row, 1, 1);
			}
		}
	}
	return canvas;
}

/** Draws one string-array sprite at (x, y), 1 grid cell = 1 canvas px. */
export function drawSprite(
	ctx: CanvasRenderingContext2D,
	sprite: string[],
	x: number,
	y: number
): void {
	let cached = spriteCache.get(sprite);
	if (!cached) {
		cached = rasterize(sprite);
		spriteCache.set(sprite, cached);
	}
	ctx.drawImage(cached, x, y);
}

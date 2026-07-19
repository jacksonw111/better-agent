/* eslint-disable no-magic-numbers -- pixel-art level geometry is inherently numeric literals */
import {
	DAY_PALETTE,
	drawSprite,
	NIGHT_PALETTE,
	type PixelPalette,
	RUNNER_JUMP,
	RUNNER_RUN_1,
	RUNNER_RUN_2,
} from "./pixel-loading-sprites";

// A deterministic, stateless side-scroller: every frame is a pure function of
// elapsed time, so there's no simulation state to drift or leak. The level
// loops — a nod to a classic first overworld level (pipes rising in height,
// ?-blocks, a stair, flag and castle) built from original art.

export const SCENE_W = 256;
export const SCENE_H = 96;

const GROUND_Y = 80;
const SPEED_PX_S = 44;
const LEVEL_LEN = 1536;
const CHAR_SCREEN_X = 48;
const BLOCK = 12;
const PIPE_W = 18;
const HALF = 0.5;

const PIPES = [
	{ x: 352, h: 16 },
	{ x: 544, h: 24 },
	{ x: 736, h: 32 },
	{ x: 1056, h: 24 },
];
const STAIR = { x: 1216, steps: 3, w: 3 * BLOCK };
const BLOCKS = [
	{ x: 208, q: false },
	{ x: 220, q: true },
	{ x: 232, q: false },
	{ x: 640, q: true },
	{ x: 652, q: false },
	{ x: 664, q: true },
	{ x: 928, q: true },
];
const BLOCK_Y = GROUND_Y - 36;
const FLAG_X = 1400;
const CASTLE_X = 1440;
const CLOUDS = [20, 120, 210, 330, 430];
const HILLS = [40, 260, 470, 640];
const STARS: Array<[number, number]> = [
	[18, 10],
	[52, 22],
	[90, 6],
	[130, 16],
	[170, 9],
	[205, 20],
	[240, 12],
];

// Everything the runner has to clear, as [start, width, clearance-height].
const OBSTACLES = [
	...PIPES.map((p) => ({ x: p.x, w: PIPE_W, h: p.h })),
	{ x: STAIR.x, w: STAIR.w, h: STAIR.steps * BLOCK },
];

/** Calls draw for every on-screen copy of a level object (the level wraps). */
function forVisible(
	scroll: number,
	x: number,
	span: number,
	draw: (screenX: number) => void
): void {
	for (const world of [x, x + LEVEL_LEN]) {
		const screenX = world - scroll;
		if (screenX > -span && screenX < SCENE_W + span) {
			draw(screenX);
		}
	}
}

function drawBackdrop(
	ctx: CanvasRenderingContext2D,
	p: PixelPalette,
	scroll: number,
	night: boolean
): void {
	ctx.fillStyle = p.sky;
	ctx.fillRect(0, 0, SCENE_W, SCENE_H);
	if (night) {
		ctx.fillStyle = p.star;
		for (const [x, y] of STARS) {
			ctx.fillRect(x, y, 1, 1);
		}
	}
	ctx.fillStyle = p.cloud;
	const cloudScroll = (scroll * 0.3) % 512;
	for (const base of CLOUDS) {
		for (const world of [base, base + 512]) {
			const x = world - cloudScroll;
			ctx.fillRect(x, 14, 22, 6);
			ctx.fillRect(x + 4, 10, 14, 4);
		}
	}
	const hillScroll = (scroll * HALF) % 768;
	for (const base of HILLS) {
		for (const world of [base, base + 768]) {
			const x = world - hillScroll;
			ctx.fillStyle = p.hill;
			ctx.fillRect(x, GROUND_Y - 12, 40, 12);
			ctx.fillRect(x + 8, GROUND_Y - 20, 24, 8);
			ctx.fillStyle = p.hillDark;
			ctx.fillRect(x + 16, GROUND_Y - 24, 8, 4);
		}
	}
}

function drawGround(
	ctx: CanvasRenderingContext2D,
	p: PixelPalette,
	scroll: number
): void {
	ctx.fillStyle = p.brick;
	ctx.fillRect(0, GROUND_Y, SCENE_W, SCENE_H - GROUND_Y);
	ctx.fillStyle = p.brickDark;
	const offset = scroll % 16;
	for (let y = GROUND_Y; y < SCENE_H; y += 8) {
		ctx.fillRect(0, y, SCENE_W, 1);
		const stagger = ((y - GROUND_Y) / 8) % 2 === 0 ? 0 : 8;
		for (let x = -16; x < SCENE_W + 16; x += 16) {
			ctx.fillRect(x - offset + stagger, y, 1, 8);
		}
	}
}

function drawPipe(
	ctx: CanvasRenderingContext2D,
	p: PixelPalette,
	x: number,
	h: number
): void {
	const top = GROUND_Y - h;
	ctx.fillStyle = p.pipe;
	ctx.fillRect(x + 2, top + 6, PIPE_W - 4, h - 6);
	ctx.fillRect(x, top, PIPE_W, 6);
	ctx.fillStyle = p.pipeDark;
	ctx.fillRect(x + PIPE_W - 6, top + 6, 2, h - 6);
	ctx.fillRect(x + PIPE_W - 3, top, 2, 6);
	ctx.fillRect(x, top + 5, PIPE_W, 1);
}

function drawBlockTile(
	ctx: CanvasRenderingContext2D,
	p: PixelPalette,
	x: number,
	y: number,
	q: boolean
): void {
	ctx.fillStyle = q ? p.block : p.brick;
	ctx.fillRect(x, y, BLOCK, BLOCK);
	ctx.fillStyle = q ? p.blockDark : p.brickDark;
	ctx.fillRect(x, y + BLOCK - 1, BLOCK, 1);
	ctx.fillRect(x + BLOCK - 1, y, 1, BLOCK);
	if (q) {
		ctx.fillRect(x + 5, y + 3, 3, 2);
		ctx.fillRect(x + 6, y + 5, 2, 3);
		ctx.fillRect(x + 6, y + 9, 2, 1);
	} else {
		ctx.fillRect(x, y + 5, BLOCK, 1);
		ctx.fillRect(x + 5, y, 1, 5);
		ctx.fillRect(x + 8, y + 6, 1, 6);
	}
}

function drawStair(
	ctx: CanvasRenderingContext2D,
	p: PixelPalette,
	x: number
): void {
	for (let step = 0; step < STAIR.steps; step++) {
		for (let row = 0; row <= step; row++) {
			drawBlockTile(
				ctx,
				p,
				x + step * BLOCK,
				GROUND_Y - (row + 1) * BLOCK,
				false
			);
		}
	}
}

function drawFinish(
	ctx: CanvasRenderingContext2D,
	p: PixelPalette,
	x: number
): void {
	ctx.fillStyle = p.pole;
	ctx.fillRect(x, GROUND_Y - 56, 2, 56);
	ctx.fillStyle = p.flag;
	ctx.fillRect(x - 10, GROUND_Y - 54, 10, 7);
	const cx = x + CASTLE_X - FLAG_X;
	ctx.fillStyle = p.castle;
	ctx.fillRect(cx, GROUND_Y - 24, 36, 24);
	ctx.fillRect(cx + 8, GROUND_Y - 32, 20, 8);
	for (let i = 0; i < 5; i++) {
		ctx.fillRect(cx + i * 8, GROUND_Y - 28, 4, 4);
	}
	ctx.fillStyle = p.brickDark;
	ctx.fillRect(cx + 14, GROUND_Y - 12, 8, 12);
}

/** The runner's jump lift at a world position — max over nearby obstacles. */
export function jumpLift(worldX: number): number {
	const x = worldX % LEVEL_LEN;
	let lift = 0;
	for (const obs of OBSTACLES) {
		const start = obs.x - 22;
		const end = obs.x + obs.w + 10;
		if (x > start && x < end) {
			const progress = (x - start) / (end - start);
			lift = Math.max(lift, (obs.h + 14) * Math.sin(Math.PI * progress));
		}
	}
	return lift;
}

function drawCoins(
	ctx: CanvasRenderingContext2D,
	p: PixelPalette,
	scroll: number,
	charWorldX: number
): void {
	const x = charWorldX % LEVEL_LEN;
	for (const block of BLOCKS) {
		if (!block.q) {
			continue;
		}
		const start = block.x - 4;
		const end = block.x + BLOCK + 8;
		if (x > start && x < end) {
			const progress = (x - start) / (end - start);
			const rise = 16 * Math.sin(Math.PI * Math.min(progress, 1));
			forVisible(scroll, block.x, BLOCK, (screenX) => {
				ctx.fillStyle = p.coin;
				ctx.fillRect(screenX + 4, BLOCK_Y - 6 - rise, 4, 6);
				ctx.fillStyle = p.blockDark;
				ctx.fillRect(screenX + 5, BLOCK_Y - 5 - rise, 1, 4);
			});
		}
	}
}

function drawRunner(
	ctx: CanvasRenderingContext2D,
	timeMs: number,
	charWorldX: number
): void {
	const lift = jumpLift(charWorldX);
	const runFrame =
		Math.floor(timeMs / 90) % 2 === 0 ? RUNNER_RUN_1 : RUNNER_RUN_2;
	const sprite = lift > 2 ? RUNNER_JUMP : runFrame;
	drawSprite(ctx, sprite, CHAR_SCREEN_X, GROUND_Y - 12 - lift);
}

/** One full frame. Pure: same (timeMs, night) → same pixels. */
export function drawPixelScene(
	ctx: CanvasRenderingContext2D,
	timeMs: number,
	night: boolean
): void {
	const p = night ? NIGHT_PALETTE : DAY_PALETTE;
	const scroll = ((timeMs / 1000) * SPEED_PX_S) % LEVEL_LEN;
	const charWorldX = scroll + CHAR_SCREEN_X;
	drawBackdrop(ctx, p, scroll, night);
	drawGround(ctx, p, scroll);
	for (const block of BLOCKS) {
		forVisible(scroll, block.x, BLOCK, (sx) =>
			drawBlockTile(ctx, p, sx, BLOCK_Y, block.q)
		);
	}
	drawCoins(ctx, p, scroll, charWorldX);
	for (const pipe of PIPES) {
		forVisible(scroll, pipe.x, PIPE_W, (sx) => drawPipe(ctx, p, sx, pipe.h));
	}
	forVisible(scroll, STAIR.x, STAIR.w, (sx) => drawStair(ctx, p, sx));
	forVisible(scroll, FLAG_X, 96, (sx) => drawFinish(ctx, p, sx));
	drawRunner(ctx, timeMs, charWorldX);
}

// Shared `#rrggbb` → `rgba(r, g, b, alpha)` helper. Both the candlestick
// volume histogram (candlestick-canvas.tsx) and the sector heatmap tiles
// (sector-heatmap.tsx) derive a translucent fill from a chart-theme hex rather
// than hardcoding a second RGB literal (§11 图表 token 单一出口) — this is the
// one copy they share instead of each re-declaring the byte math.

const HEX_RGB_LEN = 6;
const HEX_RADIX = 16;
const HEX_BYTE_LEN = 2;
const HEX_R_START = 0;
const HEX_G_START = HEX_R_START + HEX_BYTE_LEN;
const HEX_B_START = HEX_G_START + HEX_BYTE_LEN;
const HEX_B_END = HEX_B_START + HEX_BYTE_LEN;

export function hexToRgba(hex: string, alpha: number): string {
	const clean = hex.replace("#", "").padEnd(HEX_RGB_LEN, "0");
	const r = Number.parseInt(clean.slice(HEX_R_START, HEX_G_START), HEX_RADIX);
	const g = Number.parseInt(clean.slice(HEX_G_START, HEX_B_START), HEX_RADIX);
	const b = Number.parseInt(clean.slice(HEX_B_START, HEX_B_END), HEX_RADIX);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

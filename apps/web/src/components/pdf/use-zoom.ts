import { useState } from "react";

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const SCALE_STEP = 0.2;
const DEFAULT_SCALE = 1;

export interface ZoomControls {
	reset: () => void;
	scale: number;
	zoomIn: () => void;
	zoomOut: () => void;
}

export function useZoom(): ZoomControls {
	const [scale, setScale] = useState(DEFAULT_SCALE);

	const zoomIn = () =>
		setScale((s) => Math.min(MAX_SCALE, Number((s + SCALE_STEP).toFixed(1))));
	const zoomOut = () =>
		setScale((s) => Math.max(MIN_SCALE, Number((s - SCALE_STEP).toFixed(1))));
	const reset = () => setScale(DEFAULT_SCALE);

	return { scale, zoomIn, zoomOut, reset };
}

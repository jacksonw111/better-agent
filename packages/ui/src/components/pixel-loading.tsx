"use client";

import { cn } from "@better-agent/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import { drawPixelScene, SCENE_H, SCENE_W } from "./pixel-loading-scene";

// A pixel-art platformer loading animation — the little runner plays through
// a looping first level (pipes, ?-blocks, stair, flag) while the user waits.
// Day palette in light mode, moonlit palette in dark mode; honors
// prefers-reduced-motion by rendering a single static frame.

// An arbitrary-but-fixed timestamp so the reduced-motion frame shows the
// runner mid-level rather than the very first pixel of the loop.
const STATIC_FRAME_MS = 4200;

/** Dark-mode flag that tracks the app's `dark` class live (theme toggles
 * mid-wait repaint the scene) with prefers-color-scheme as the fallback. */
function useIsDarkTheme(): boolean {
	const [dark, setDark] = useState(false);
	useEffect(() => {
		const root = document.documentElement;
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const compute = () =>
			setDark(root.classList.contains("dark") || media.matches);
		compute();
		const observer = new MutationObserver(compute);
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		media.addEventListener("change", compute);
		return () => {
			observer.disconnect();
			media.removeEventListener("change", compute);
		};
	}, []);
	return dark;
}

function usePixelSceneLoop(
	canvasRef: React.RefObject<HTMLCanvasElement | null>,
	night: boolean
): void {
	useEffect(() => {
		const ctx = canvasRef.current?.getContext("2d");
		const reduced = window.matchMedia(
			"(prefers-reduced-motion: reduce)"
		).matches;
		// 0 is never a live handle, so the cleanup's cancel is a safe no-op on
		// the static-frame and no-canvas paths (single exit keeps
		// consistent-return happy).
		let frame = 0;
		if (ctx && reduced) {
			drawPixelScene(ctx, STATIC_FRAME_MS, night);
		}
		if (ctx && !reduced) {
			const start = performance.now();
			const render = (now: number) => {
				drawPixelScene(ctx, now - start, night);
				frame = requestAnimationFrame(render);
			};
			frame = requestAnimationFrame(render);
		}
		return () => cancelAnimationFrame(frame);
	}, [canvasRef, night]);
}

/** The pixel platformer loader. Sized by its container (canvas upscales with
 * crisp pixels); pair with a label for context, e.g. "Loading documents…". */
export function PixelLoading({
	className,
	label = "Loading…",
}: {
	className?: string;
	label?: string;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const night = useIsDarkTheme();
	usePixelSceneLoop(canvasRef, night);
	return (
		<div
			aria-label={label}
			className={cn("flex w-full flex-col items-center gap-2 py-6", className)}
			role="status"
		>
			<canvas
				className="w-full max-w-md rounded-lg"
				height={SCENE_H}
				ref={canvasRef}
				style={{ imageRendering: "pixelated" }}
				width={SCENE_W}
			/>
			<span className="text-muted-foreground text-xs">{label}</span>
		</div>
	);
}

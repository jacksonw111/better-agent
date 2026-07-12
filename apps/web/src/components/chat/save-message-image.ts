import { toast } from "sonner";

const EXPORT_PIXEL_RATIO = 2;
const SHORT_ID_LENGTH = 8;

function shortMessageId(id: string): string {
	return id.slice(0, SHORT_ID_LENGTH) || "reply";
}

// Charts (recharts SVGs, lightweight-charts canvases) can still be settling
// their layout the instant the button is clicked; two animation frames give
// them a beat to finish painting before the DOM is rasterized.
function waitForPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

// The message bubble itself is transparent (`ghost` variant), so without an
// explicit background html-to-image rasterizes it onto a transparent canvas —
// invisible on a light PNG viewer and black-on-nothing in most others. Reading
// the resolved body background keeps the export correct in both themes.
function themeBackground(): string {
	return getComputedStyle(document.body).backgroundColor;
}

function downloadDataUrl(dataUrl: string, filename: string): void {
	const link = document.createElement("a");
	link.href = dataUrl;
	link.download = filename;
	link.click();
}

/** Renders an assistant message's content node (text + any genui charts/
 * tables inside it) to a PNG and downloads it. Matches the `SaveImageHandler`
 * shape expected by `@better-agent/ui`'s `Conversation`/`ChatRow`. Never
 * throws — capture failures (e.g. a tainted canvas from a cross-origin chart
 * image) surface as a toast instead of breaking the chat UI. */
export async function saveMessageAsImage({
	message,
	node,
}: {
	message: { id: string };
	node: HTMLElement;
}): Promise<void> {
	try {
		// Loaded on demand — html-to-image only matters when the user actually
		// exports an answer, so it shouldn't ship in the eager chat bundle.
		const { toPng } = await import("html-to-image");
		await waitForPaint();
		const dataUrl = await toPng(node, {
			backgroundColor: themeBackground(),
			pixelRatio: EXPORT_PIXEL_RATIO,
		});
		downloadDataUrl(dataUrl, `agent-answer-${shortMessageId(message.id)}.png`);
	} catch {
		toast.error("Couldn't export image", {
			description: "Some content in this reply blocked the capture.",
		});
	}
}

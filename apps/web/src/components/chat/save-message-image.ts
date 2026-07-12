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

const DATA_URL_MIME_RE = /:(.*?);/;

function dataUrlToFile(dataUrl: string, filename: string): File {
	const [header, base64 = ""] = dataUrl.split(",");
	const mime = header?.match(DATA_URL_MIME_RE)?.[1] ?? "image/png";
	const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
	return new File([bytes], filename, { type: mime });
}

/** Saves the PNG. Mobile browsers ignore `<a download>` for a generated image
 * (the tap just opens it), so where the Web Share sheet can take files — iOS
 * Safari, Android Chrome — use it (save to Photos/Files); desktop keeps the
 * plain download. Throws `AbortError` if the user dismisses the share sheet. */
async function exportPng(dataUrl: string, filename: string): Promise<void> {
	const file = dataUrlToFile(dataUrl, filename);
	const share = navigator.canShare?.({ files: [file] })
		? navigator.share.bind(navigator)
		: null;
	if (share) {
		await share({ files: [file], title: filename });
		return;
	}
	downloadDataUrl(dataUrl, filename);
}

/** Renders an assistant message's content node (text + any genui charts/
 * tables inside it) to a PNG and saves it (share sheet on mobile, download on
 * desktop). Matches the `SaveImageHandler` shape expected by
 * `@better-agent/ui`'s `Conversation`/`ChatRow`. Never throws — capture
 * failures surface as a toast; a dismissed share sheet is a silent no-op. */
export async function saveMessageAsImage({
	message,
	node,
}: {
	message: { id: string };
	node: HTMLElement;
}): Promise<void> {
	let dataUrl: string;
	try {
		// Loaded on demand — html-to-image only matters when the user actually
		// exports an answer, so it shouldn't ship in the eager chat bundle.
		const { toPng } = await import("html-to-image");
		await waitForPaint();
		dataUrl = await toPng(node, {
			backgroundColor: themeBackground(),
			pixelRatio: EXPORT_PIXEL_RATIO,
		});
	} catch {
		toast.error("Couldn't export image", {
			description: "Some content in this reply blocked the capture.",
		});
		return;
	}
	try {
		await exportPng(dataUrl, `agent-answer-${shortMessageId(message.id)}.png`);
	} catch (error) {
		// User dismissed the share sheet — not an error.
		if (error instanceof DOMException && error.name === "AbortError") {
			return;
		}
		toast.error("Couldn't save image");
	}
}

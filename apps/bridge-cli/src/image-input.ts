// P3-T2: the CLI's image layer. The web's text command carries id-based
// `ImageRef`s (see commands-text-when.ts); this wrapper sits between the
// command dispatch and the adapter's `AgentHandle`, downloading each
// referenced attachment (`bridge.getBridgeAttachment`) and handing the
// adapter ready-to-inject base64 `AgentImage`s. Downloads are bounded (15s
// each, 8MB guard); a failed download NEVER drops the user's text — it goes
// out anyway with a visible bracketed note appended, plus a best-effort
// status event. Agents whose capability handshake says `images: false`
// (codex/opencode) get the images stripped with the same status-note
// treatment. NOTE: a send with images resolves asynchronously, so a
// text-only command arriving in the same poll batch can overtake it — an
// accepted tradeoff (downloads are small and local-network fast).

import type { AgentHandle, AgentImage, TextWhen } from "./adapters/types";
import type { ImageRef } from "./commands-text-when";

const DOWNLOAD_TIMEOUT_MS = 15_000;
/** Mirrors the server's upload cap (`MAX_UPLOAD_BYTES`,
 * packages/api/src/attachments.ts) — a defense-in-depth guard, since
 * everything downloadable here already passed that validation. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Suffix appended to the user's text when images ride along — BYTE-IDENTICAL
 * to the web composer's own echo suffix (see
 * apps/web/src/components/bridge/use-image-attachments.ts's
 * `imageCountSuffix`; keep the two in sync), so the optimistic local echo and
 * the CLI-persisted user message match and the echo dedupes cleanly. */
export function imageCountSuffix(count: number): string {
	return count > 0 ? ` [图片×${count}]` : "";
}

export interface ImageInputDeps {
	/** Downloads one attachment's bytes (`transport.getAttachment`). Absent on
	 * an older/other transport — every image then takes the failed-download
	 * path rather than crashing. */
	fetchImage?: (attachmentId: string) => Promise<File>;
	/** Best-effort status push straight to the server (fire-and-forget, same
	 * contract as session-watchdog-wiring.ts's `pushStalledStatus`). */
	pushStatus: (event: unknown) => void;
	/** From the adapter's own capability constant — see
	 * `agentSupportsImages` (adapters/session-capabilities.ts). */
	supportsImages: boolean;
}

/** `AgentHandle` with the send surface retyped to the WIRE's id-based
 * `ImageRef`s — what `withImageInput` returns, and shape-compatible with the
 * `CommandSink` the poll loop dispatches into. */
export type ImageInputHandle = Omit<AgentHandle, "send" | "sendWith"> & {
	send(text: string, images?: ImageRef[]): void;
	sendWith?(text: string, when: TextWhen, images?: ImageRef[]): void;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`image download timed out after ${ms}ms`));
		}, ms);
		promise
			.then((value) => {
				clearTimeout(timer);
				resolve(value);
			})
			.catch((error: unknown) => {
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			});
	});
}

async function downloadOne(
	ref: ImageRef,
	fetchImage: (attachmentId: string) => Promise<File>
): Promise<AgentImage> {
	const file = await withTimeout(fetchImage(ref.id), DOWNLOAD_TIMEOUT_MS);
	const buffer = await file.arrayBuffer();
	if (buffer.byteLength > MAX_IMAGE_BYTES) {
		throw new Error(`image exceeds the ${MAX_IMAGE_BYTES}-byte cap`);
	}
	return {
		data: Buffer.from(buffer).toString("base64"),
		mimeType: ref.mime,
		name: ref.name,
	};
}

interface ResolvedImages {
	failedNames: string[];
	images: AgentImage[];
}

type DownloadOutcome =
	| { image: AgentImage; ok: true }
	| { name: string; ok: false };

/** Downloads every ref, never rejecting: failures land in `failedNames` so
 * the text still goes out with a note instead of the whole send dying. */
async function resolveImages(
	refs: ImageRef[],
	fetchImage: (attachmentId: string) => Promise<File>
): Promise<ResolvedImages> {
	const outcomes: DownloadOutcome[] = await Promise.all(
		refs.map(async (ref) => {
			try {
				return { image: await downloadOne(ref, fetchImage), ok: true as const };
			} catch {
				return { name: ref.name, ok: false as const };
			}
		})
	);
	const images: AgentImage[] = [];
	const failedNames: string[] = [];
	for (const outcome of outcomes) {
		if (outcome.ok) {
			images.push(outcome.image);
		} else {
			failedNames.push(outcome.name);
		}
	}
	return { failedNames, images };
}

type ForwardSend = (text: string, images?: AgentImage[]) => void;

/** Routes one image-carrying send: strip (with a status note) for a
 * non-supporting agent or a transport without `getAttachment`, otherwise
 * download-then-forward, appending a `[图片下载失败: name]` note per failure. */
function sendWithImages(
	deps: ImageInputDeps,
	refs: ImageRef[],
	text: string,
	forward: ForwardSend
): void {
	const base = `${text}${imageCountSuffix(refs.length)}`;
	if (!(deps.supportsImages && deps.fetchImage)) {
		deps.pushStatus({
			kind: "status",
			status: "images_dropped",
			detail: { names: refs.map((ref) => ref.name) },
		});
		forward(base);
		return;
	}
	resolveImages(refs, deps.fetchImage)
		.then(({ failedNames, images }) => {
			if (failedNames.length > 0) {
				deps.pushStatus({
					kind: "status",
					status: "image_download_failed",
					detail: { names: failedNames },
				});
			}
			const notes = failedNames
				.map((name) => ` [图片下载失败: ${name}]`)
				.join("");
			forward(`${base}${notes}`, images.length > 0 ? images : undefined);
		})
		.catch(() => {
			// resolveImages never rejects; defensive so the text can't be lost.
			forward(base);
		});
}

/** Wraps an adapter's handle so the command dispatch can hand it WIRE image
 * refs: a ref-less send passes straight through (byte-identical to before
 * P3-T2), a ref-carrying one resolves asynchronously via `sendWithImages`. */
export function withImageInput(
	handle: AgentHandle,
	deps: ImageInputDeps
): ImageInputHandle {
	const sendWith = handle.sendWith?.bind(handle);
	const base: Omit<AgentHandle, "send" | "sendWith"> = handle;
	const wrapped: ImageInputHandle = {
		...base,
		send(text: string, images?: ImageRef[]): void {
			if (!images || images.length === 0) {
				handle.send(text);
				return;
			}
			sendWithImages(deps, images, text, (finalText, resolved) => {
				// Arity-preserving: an image-less forward (strip/failure path) calls
				// the underlying send exactly like a pre-P3-T2 caller would.
				if (resolved) {
					handle.send(finalText, resolved);
				} else {
					handle.send(finalText);
				}
			});
		},
	};
	if (sendWith) {
		wrapped.sendWith = (text: string, when: TextWhen, images?: ImageRef[]) => {
			if (!images || images.length === 0) {
				sendWith(text, when);
				return;
			}
			sendWithImages(deps, images, text, (finalText, resolved) => {
				if (resolved) {
					sendWith(finalText, when, resolved);
				} else {
					sendWith(finalText, when);
				}
			});
		};
	}
	return wrapped;
}

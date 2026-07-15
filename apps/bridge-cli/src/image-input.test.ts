import { expect, it, vi } from "vitest";
import type { AgentHandle, AgentImage, TextWhen } from "./adapters/types";
import type { ImageRef } from "./commands-text-when";
import {
	type ImageInputDeps,
	imageCountSuffix,
	withImageInput,
} from "./image-input";

function makeHandle() {
	const send = vi.fn<(text: string, images?: AgentImage[]) => void>();
	const sendWith =
		vi.fn<(text: string, when: TextWhen, images?: AgentImage[]) => void>();
	const handle = { send, sendWith } as unknown as AgentHandle;
	return { handle, send, sendWith };
}

function fileOf(bytes: number, name = "shot.png"): File {
	return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

const REF: ImageRef = { id: "att-1", mime: "image/png", name: "shot.png" };

function deps(overrides: Partial<ImageInputDeps> = {}): ImageInputDeps & {
	pushed: unknown[];
} {
	const pushed: unknown[] = [];
	return {
		fetchImage: () => Promise.resolve(fileOf(8)),
		pushStatus: (event) => pushed.push(event),
		supportsImages: true,
		pushed,
		...overrides,
	};
}

async function settled(): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

it("passes a ref-less send through unchanged (single argument)", () => {
	const { handle, send } = makeHandle();
	withImageInput(handle, deps()).send("hello");
	expect(send).toHaveBeenCalledWith("hello");
	expect(send.mock.calls[0]).toHaveLength(1);
});

it("downloads refs and forwards base64 images with the count suffix", async () => {
	const { handle, send } = makeHandle();
	withImageInput(handle, deps()).send("look", [REF]);
	await settled();
	expect(send).toHaveBeenCalledTimes(1);
	const [text, images] = send.mock.calls[0] as [string, AgentImage[]];
	expect(text).toBe(`look${imageCountSuffix(1)}`);
	expect(images).toHaveLength(1);
	expect(images[0]).toMatchObject({
		mimeType: "image/png",
		name: "shot.png",
	});
	expect(typeof images[0]?.data).toBe("string");
});

it("strips images (with an images_dropped status) for a non-supporting agent", async () => {
	const { handle, send } = makeHandle();
	const d = deps({ supportsImages: false });
	withImageInput(handle, d).send("look", [REF]);
	await settled();
	expect(send).toHaveBeenCalledWith(`look${imageCountSuffix(1)}`);
	expect(d.pushed).toContainEqual(
		expect.objectContaining({ status: "images_dropped" })
	);
});

it("strips images when the transport has no getAttachment", async () => {
	const { handle, send } = makeHandle();
	const d = deps({ fetchImage: undefined });
	withImageInput(handle, d).send("look", [REF]);
	await settled();
	expect(send).toHaveBeenCalledWith(`look${imageCountSuffix(1)}`);
	expect(d.pushed).toContainEqual(
		expect.objectContaining({ status: "images_dropped" })
	);
});

it("a failed download never drops the text: bracketed note + status event", async () => {
	const { handle, send } = makeHandle();
	const d = deps({
		fetchImage: () => Promise.reject(new Error("boom")),
	});
	withImageInput(handle, d).send("look", [REF]);
	await settled();
	const [text, images] = send.mock.calls[0] as [
		string,
		AgentImage[] | undefined,
	];
	expect(text).toBe(`look${imageCountSuffix(1)} [图片下载失败: shot.png]`);
	expect(images).toBeUndefined();
	expect(d.pushed).toContainEqual(
		expect.objectContaining({ status: "image_download_failed" })
	);
});

it("an oversized download takes the failed path", async () => {
	const { handle, send } = makeHandle();
	const d = deps({
		fetchImage: () => Promise.resolve(fileOf(8 * 1024 * 1024 + 1)),
	});
	withImageInput(handle, d).send("look", [REF]);
	await settled();
	const [text] = send.mock.calls[0] as [string];
	expect(text).toContain("[图片下载失败: shot.png]");
});

it("mixed outcomes: good images forwarded, failed ones noted", async () => {
	const { handle, send } = makeHandle();
	const bad: ImageRef = { id: "att-2", mime: "image/png", name: "bad.png" };
	const d = deps({
		fetchImage: (id) =>
			id === "att-1"
				? Promise.resolve(fileOf(8))
				: Promise.reject(new Error("gone")),
	});
	withImageInput(handle, d).send("look", [REF, bad]);
	await settled();
	const [text, images] = send.mock.calls[0] as [string, AgentImage[]];
	expect(text).toBe(`look${imageCountSuffix(2)} [图片下载失败: bad.png]`);
	expect(images).toHaveLength(1);
});

it("sendWith keeps the when policy on the image path", async () => {
	const { handle, sendWith } = makeHandle();
	const wrapped = withImageInput(handle, deps());
	wrapped.sendWith?.("go", "steer", [REF]);
	await settled();
	const [text, when, images] = sendWith.mock.calls[0] as [
		string,
		TextWhen,
		AgentImage[],
	];
	expect(text).toBe(`go${imageCountSuffix(1)}`);
	expect(when).toBe("steer");
	expect(images).toHaveLength(1);
});

it("a ref-less sendWith stays arity-identical to before", () => {
	const { handle, sendWith } = makeHandle();
	withImageInput(handle, deps()).sendWith?.("go", "interrupt");
	expect(sendWith).toHaveBeenCalledWith("go", "interrupt");
	expect(sendWith.mock.calls[0]).toHaveLength(2);
});

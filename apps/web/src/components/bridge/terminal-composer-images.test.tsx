// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
	TerminalComposer,
	type TerminalComposerProps,
} from "./terminal-composer";
import type { ImageRef } from "./use-image-attachments";

// P3-T2: the composer's attach surface — gated on `imageUpload`, uploads on
// attach, and a send carries the uploaded refs as the third onSend argument.

afterEach(cleanup);

const REF: ImageRef = { id: "att-1", mime: "image/png", name: "shot.png" };

function baseProps(
	overrides: Partial<TerminalComposerProps> = {}
): TerminalComposerProps {
	return {
		disabled: false,
		onSend: vi.fn(),
		sending: false,
		...overrides,
	};
}

function attachPng(name = "shot.png") {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]');
	if (!input) {
		throw new Error("attach input not mounted");
	}
	const file = new File([new Uint8Array(8)], name, { type: "image/png" });
	fireEvent.change(input, { target: { files: [file] } });
}

async function flushUploads() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

it("hides the attach surface without imageUpload", () => {
	render(<TerminalComposer {...baseProps()} />);
	expect(screen.queryByLabelText("附加图片")).toBeNull();
});

it("uploads on attach and sends the refs with the text", async () => {
	const onSend = vi.fn();
	const imageUpload = vi.fn().mockResolvedValue(REF);
	render(<TerminalComposer {...baseProps({ imageUpload, onSend })} />);

	attachPng();
	expect(imageUpload).toHaveBeenCalledTimes(1);
	await flushUploads();

	const textarea = screen.getByPlaceholderText("Send a message…");
	fireEvent.change(textarea, { target: { value: "看这个" } });
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(onSend).toHaveBeenCalledWith("看这个", undefined, [REF]);
});

it("allows an image-only send (empty text)", async () => {
	const onSend = vi.fn();
	const imageUpload = vi.fn().mockResolvedValue(REF);
	render(<TerminalComposer {...baseProps({ imageUpload, onSend })} />);

	attachPng();
	await flushUploads();
	const textarea = screen.getByPlaceholderText("Send a message…");
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(onSend).toHaveBeenCalledWith("", undefined, [REF]);
});

it("blocks the send while an upload is still in flight", () => {
	const onSend = vi.fn();
	const imageUpload = vi.fn().mockReturnValue(new Promise(() => undefined));
	render(<TerminalComposer {...baseProps({ imageUpload, onSend })} />);

	attachPng();
	const textarea = screen.getByPlaceholderText("Send a message…");
	fireEvent.change(textarea, { target: { value: "太快了" } });
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(onSend).not.toHaveBeenCalled();
});

it("a busy queue submit carries the refs into the web queue", async () => {
	const onSend = vi.fn();
	const enqueue = vi.fn();
	const imageUpload = vi.fn().mockResolvedValue(REF);
	render(
		<TerminalComposer
			{...baseProps({
				imageUpload,
				onSend,
				turnInFlight: true,
				webQueue: { enqueue, items: [], remove: vi.fn() },
			})}
		/>
	);

	attachPng();
	await flushUploads();
	const textarea = screen.getByPlaceholderText("Send a message…");
	fireEvent.change(textarea, { target: { value: "排队图" } });
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(enqueue).toHaveBeenCalledWith("排队图", [REF]);
	expect(onSend).not.toHaveBeenCalled();
});

it("pasting an image file attaches it", () => {
	const imageUpload = vi.fn().mockResolvedValue(REF);
	render(<TerminalComposer {...baseProps({ imageUpload })} />);

	const textarea = screen.getByPlaceholderText("Send a message…");
	const file = new File([new Uint8Array(4)], "paste.png", {
		type: "image/png",
	});
	fireEvent.paste(textarea, {
		clipboardData: { files: [file] },
	});
	expect(imageUpload).toHaveBeenCalledTimes(1);
});

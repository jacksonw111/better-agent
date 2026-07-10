// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveMessageAsImage } from "./save-message-image";

const toPngMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("html-to-image", () => ({ toPng: toPngMock }));
vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));

function makeNode(): HTMLElement {
	const node = document.createElement("div");
	node.textContent = "the answer, plus a chart";
	document.body.append(node);
	return node;
}

beforeEach(() => {
	toPngMock.mockReset();
	toastErrorMock.mockReset();
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
		// jsdom doesn't implement anchor navigation; only the click matters here.
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

it("captures the message node with the theme background and downloads a PNG", async () => {
	toPngMock.mockResolvedValue("data:image/png;base64,fake");
	const node = makeNode();

	await saveMessageAsImage({ message: { id: "msg-abcdef12345" }, node });

	expect(toPngMock).toHaveBeenCalledTimes(1);
	const [capturedNode, options] = toPngMock.mock.calls[0] as [
		HTMLElement,
		{ backgroundColor: string; pixelRatio: number },
	];
	expect(capturedNode).toBe(node);
	expect(options).toMatchObject({ pixelRatio: 2 });
	expect(typeof options.backgroundColor).toBe("string");

	expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
});

it("names the download after a short prefix of the message id", async () => {
	toPngMock.mockResolvedValue("data:image/png;base64,fake");
	const node = makeNode();
	let capturedHref = "";
	let capturedDownload = "";
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
		function click(this: HTMLAnchorElement) {
			capturedHref = this.href;
			capturedDownload = this.download;
		}
	);

	await saveMessageAsImage({ message: { id: "msg-abcdef12345" }, node });

	expect(capturedDownload).toBe("agent-answer-msg-abcd.png");
	expect(capturedHref).toBe("data:image/png;base64,fake");
});

it("toasts an error instead of throwing when the capture fails", async () => {
	toPngMock.mockRejectedValue(new Error("tainted canvas"));
	const node = makeNode();

	await expect(
		saveMessageAsImage({ message: { id: "msg-1" }, node })
	).resolves.toBeUndefined();

	expect(toastErrorMock).toHaveBeenCalledTimes(1);
	expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});

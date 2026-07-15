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
import type { SpeechRecognitionLike } from "./use-speech-input";

// P5-2: the composer's mic surface — hidden without SpeechRecognition, and
// with a mocked one: click starts dictation, interim results show the preview
// strip, final results append into the textarea.

class MockRecognition implements SpeechRecognitionLike {
	static instances: MockRecognition[] = [];
	continuous = false;
	interimResults = false;
	lang = "";
	onend: SpeechRecognitionLike["onend"] = null;
	onerror: SpeechRecognitionLike["onerror"] = null;
	onresult: SpeechRecognitionLike["onresult"] = null;
	started = 0;
	constructor() {
		MockRecognition.instances.push(this);
	}
	start() {
		this.started += 1;
	}
	stop() {
		this.onend?.();
	}
}

const speechWindow = window as unknown as { SpeechRecognition?: unknown };

afterEach(() => {
	cleanup();
	speechWindow.SpeechRecognition = undefined;
});

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

function emitResult(transcript: string, isFinal: boolean): void {
	const recognition = MockRecognition.instances.at(-1);
	if (!recognition) {
		throw new Error("no recognition instance created");
	}
	act(() =>
		recognition.onresult?.({
			resultIndex: 0,
			results: [{ 0: { transcript }, isFinal }],
		})
	);
}

it("hides the mic where SpeechRecognition is unsupported", () => {
	render(<TerminalComposer {...baseProps()} />);
	expect(screen.queryByLabelText("语音输入")).toBeNull();
});

it("click starts dictation and a final result appends to the draft", () => {
	MockRecognition.instances = [];
	speechWindow.SpeechRecognition = MockRecognition;
	render(<TerminalComposer {...baseProps()} />);

	const textarea =
		screen.getByPlaceholderText<HTMLTextAreaElement>("Send a message…");
	fireEvent.change(textarea, { target: { value: "先打字" } });

	const mic = screen.getByLabelText("语音输入");
	fireEvent.click(mic);
	expect(MockRecognition.instances.at(-1)?.started).toBe(1);
	expect(mic.getAttribute("aria-pressed")).toBe("true");

	emitResult("正在说", false);
	expect(screen.getByRole("status").textContent).toContain("正在说");
	expect(textarea.value).toBe("先打字");

	emitResult("语音结果", true);
	expect(textarea.value).toBe("先打字 语音结果");
});

it("clicking the pressed mic stops listening and hides the strip", () => {
	MockRecognition.instances = [];
	speechWindow.SpeechRecognition = MockRecognition;
	render(<TerminalComposer {...baseProps()} />);

	const mic = screen.getByLabelText("语音输入");
	fireEvent.click(mic);
	expect(screen.getByRole("status")).toBeDefined();
	fireEvent.click(mic);
	expect(mic.getAttribute("aria-pressed")).toBe("false");
	expect(screen.queryByRole("status")).toBeNull();
});

it("the mic is disabled while the composer is disabled", () => {
	MockRecognition.instances = [];
	speechWindow.SpeechRecognition = MockRecognition;
	render(<TerminalComposer {...baseProps({ disabled: true })} />);
	expect(screen.getByLabelText<HTMLButtonElement>("语音输入").disabled).toBe(
		true
	);
});

// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type SpeechRecognitionLike, useSpeechInput } from "./use-speech-input";

// P5-2: the Web Speech dictation hook — jsdom ships no SpeechRecognition, so
// "unsupported" is the environment's natural state and "supported" is a mock
// class installed on window.

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

function installMock(): void {
	MockRecognition.instances = [];
	speechWindow.SpeechRecognition = MockRecognition;
}

function lastInstance(): MockRecognition {
	const instance = MockRecognition.instances.at(-1);
	if (!instance) {
		throw new Error("no recognition instance created");
	}
	return instance;
}

function emitResult(transcript: string, isFinal: boolean): void {
	lastInstance().onresult?.({
		resultIndex: 0,
		results: [{ 0: { transcript }, isFinal }],
	});
}

afterEach(() => {
	cleanup();
	speechWindow.SpeechRecognition = undefined;
});

it("reports unsupported (and start no-ops) where the API is absent", () => {
	const { result } = renderHook(() =>
		useSpeechInput({ onTranscript: vi.fn() })
	);
	expect(result.current.supported).toBe(false);
	act(() => result.current.start());
	expect(result.current.listening).toBe(false);
});

it("start opens a continuous interim session in the given lang", () => {
	installMock();
	const { result } = renderHook(() =>
		useSpeechInput({ lang: "zh-CN", onTranscript: vi.fn() })
	);
	expect(result.current.supported).toBe(true);
	act(() => result.current.start());
	expect(result.current.listening).toBe(true);
	const recognition = lastInstance();
	expect(recognition.started).toBe(1);
	expect(recognition.continuous).toBe(true);
	expect(recognition.interimResults).toBe(true);
	expect(recognition.lang).toBe("zh-CN");
});

it("defaults the recognition lang to navigator.language", () => {
	installMock();
	const { result } = renderHook(() =>
		useSpeechInput({ onTranscript: vi.fn() })
	);
	act(() => result.current.start());
	expect(lastInstance().lang).toBe(navigator.language);
});

it("routes interim vs final results through onTranscript", () => {
	installMock();
	const onTranscript = vi.fn();
	const { result } = renderHook(() => useSpeechInput({ onTranscript }));
	act(() => result.current.start());
	act(() => emitResult("你好", false));
	expect(onTranscript).toHaveBeenLastCalledWith("你好", false);
	act(() => emitResult("你好世界", true));
	expect(onTranscript).toHaveBeenLastCalledWith("你好世界", true);
});

it("recognition end resets listening", () => {
	installMock();
	const { result } = renderHook(() =>
		useSpeechInput({ onTranscript: vi.fn() })
	);
	act(() => result.current.start());
	act(() => lastInstance().onend?.());
	expect(result.current.listening).toBe(false);
});

it("stop ends the session and allows a fresh start", () => {
	installMock();
	const { result } = renderHook(() =>
		useSpeechInput({ onTranscript: vi.fn() })
	);
	act(() => result.current.start());
	act(() => result.current.stop());
	expect(result.current.listening).toBe(false);
	act(() => result.current.start());
	expect(result.current.listening).toBe(true);
	const sessionsAcrossRestart = 2;
	expect(MockRecognition.instances).toHaveLength(sessionsAcrossRestart);
});

it("a permission-denied error surfaces and auto-stops", () => {
	installMock();
	const { result } = renderHook(() =>
		useSpeechInput({ onTranscript: vi.fn() })
	);
	act(() => result.current.start());
	act(() => lastInstance().onerror?.({ error: "not-allowed" }));
	expect(result.current.error).toBe("not-allowed");
	expect(result.current.listening).toBe(false);
});

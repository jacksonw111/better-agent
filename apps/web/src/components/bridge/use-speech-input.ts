import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// P5-2: dictation via the browser's BUILT-IN Web Speech API
// (SpeechRecognition). This is deliberately the free v1 — the plan's 云端 STT
// (paid cloud transcription) is deferred, so nothing here talks to any
// server. Chrome/Edge/Safari expose the API (often only as the prefixed
// `webkitSpeechRecognition`); Firefox ships neither name, in which case
// `supported` is false and the whole mic surface hides.

interface SpeechAlternativeLike {
	transcript: string;
}

interface SpeechResultLike {
	readonly 0: SpeechAlternativeLike;
	isFinal: boolean;
}

interface SpeechResultEventLike {
	resultIndex: number;
	results: ArrayLike<SpeechResultLike>;
}

interface SpeechErrorEventLike {
	error: string;
}

/** The subset of the SpeechRecognition interface this hook drives — typed by
 * hand because TS's dom lib doesn't ship the (still-prefixed) API. */
export interface SpeechRecognitionLike {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onend: (() => void) | null;
	onerror: ((event: SpeechErrorEventLike) => void) | null;
	onresult: ((event: SpeechResultEventLike) => void) | null;
	start: () => void;
	stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export interface UseSpeechInputOptions {
	/** BCP-47 recognition language; defaults to `navigator.language` (so a
	 * zh-CN browser dictates in Chinese). */
	lang?: string;
	/** Interim results stream in with `isFinal: false` (live preview only,
	 * re-sent whole each time); each final segment arrives once with
	 * `isFinal: true` (commit it to the draft). */
	onTranscript: (text: string, isFinal: boolean) => void;
}

export interface UseSpeechInputResult {
	/** The last recognition error code (e.g. "not-allowed"), if any. */
	error?: string;
	listening: boolean;
	start: () => void;
	stop: () => void;
	supported: boolean;
}

/** Recognition error codes that mean the mic itself is blocked — these get a
 * toast so the user knows dictation silently stopping is a permission issue. */
const PERMISSION_ERRORS = new Set(["not-allowed", "service-not-allowed"]);

/** Feature-detects the constructor. SSR/jsdom-safe: `window` may be absent
 * entirely, and jsdom defines neither name. */
function recognitionCtor(): SpeechRecognitionCtor | undefined {
	if (typeof window === "undefined") {
		// biome-ignore lint/complexity/noUselessUndefined: explicit so every path returns a value (eslint consistent-return)
		return undefined;
	}
	const speechWindow = window as unknown as {
		SpeechRecognition?: SpeechRecognitionCtor;
		webkitSpeechRecognition?: SpeechRecognitionCtor;
	};
	return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

/** Splits one result event into final segments (each committed exactly once)
 * and the concatenated still-changing interim tail. */
function routeResults(
	event: SpeechResultEventLike,
	onTranscript: UseSpeechInputOptions["onTranscript"]
): void {
	let interim = "";
	// Indexed (not for...of): `results` is a live ArrayLike and only entries
	// from `resultIndex` on have changed since the previous event.
	for (let i = event.resultIndex; i < event.results.length; i += 1) {
		const result = event.results[i];
		if (!result) {
			continue;
		}
		if (result.isFinal) {
			onTranscript(result[0].transcript, true);
		} else {
			interim += result[0].transcript;
		}
	}
	if (interim !== "") {
		onTranscript(interim, false);
	}
}

function createRecognition(
	Ctor: SpeechRecognitionCtor,
	lang: string | undefined
): SpeechRecognitionLike {
	const recognition = new Ctor();
	recognition.continuous = true;
	recognition.interimResults = true;
	recognition.lang = lang ?? navigator.language;
	return recognition;
}

function wireRecognition(
	recognition: SpeechRecognitionLike,
	handlers: {
		onEnd: () => void;
		onError: (code: string) => void;
		onTranscript: UseSpeechInputOptions["onTranscript"];
	}
): void {
	recognition.onresult = (event) => routeResults(event, handlers.onTranscript);
	recognition.onerror = (event) => {
		handlers.onError(event.error);
		// Force termination — `onend` (below) is the single cleanup path.
		recognition.stop();
	};
	recognition.onend = handlers.onEnd;
}

/** Abandons an active session (unmount): handlers are detached FIRST so the
 * trailing `end` event can't setState on the unmounted component. */
function abandonRecognition(recognitionRef: {
	current: SpeechRecognitionLike | null;
}): void {
	const recognition = recognitionRef.current;
	if (!recognition) {
		return;
	}
	recognitionRef.current = null;
	recognition.onend = null;
	recognition.onerror = null;
	recognition.onresult = null;
	recognition.stop();
}

/**
 * Wraps `window.SpeechRecognition ?? window.webkitSpeechRecognition` for the
 * composer's mic button: `start()` opens a continuous, interim-reporting
 * session and streams transcripts to `onTranscript`; recognition `end`/`error`
 * auto-resets `listening`, and a permission-denied error additionally toasts.
 */
export function useSpeechInput(
	options: UseSpeechInputOptions
): UseSpeechInputResult {
	const [listening, setListening] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
	const onTranscriptRef = useRef(options.onTranscript);
	useEffect(() => {
		onTranscriptRef.current = options.onTranscript;
	});
	// Abandon (don't leak) an active mic session on unmount.
	useEffect(() => () => abandonRecognition(recognitionRef), []);
	const ctor = recognitionCtor();

	const start = () => {
		if (!ctor || recognitionRef.current) {
			return;
		}
		setError(undefined);
		const recognition = createRecognition(ctor, options.lang);
		wireRecognition(recognition, {
			onEnd: () => {
				recognitionRef.current = null;
				setListening(false);
			},
			onError: (code) => {
				setError(code);
				if (PERMISSION_ERRORS.has(code)) {
					toast.error("麦克风权限被拒绝，请在浏览器设置中允许后重试");
				}
			},
			onTranscript: (text, isFinal) => onTranscriptRef.current(text, isFinal),
		});
		recognitionRef.current = recognition;
		recognition.start();
		setListening(true);
	};

	return {
		error,
		listening,
		start,
		// Eager `setListening(false)` so the UI reacts immediately; the
		// recognition's own `end` event does the real cleanup.
		stop: () => {
			setListening(false);
			recognitionRef.current?.stop();
		},
		supported: ctor !== undefined,
	};
}

import { Button } from "@better-agent/ui/components/button";
import { MicIcon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { useSpeechInput } from "./use-speech-input";

// P5-2: voice dictation for the LOCAL composer — the mic button (toolbar's
// left tools, next to the paperclip) plus the live interim strip shown
// between the textarea and the toolbar while listening. Interim text stays
// OUT of the real draft state; only final segments commit via `setText`.

const TRAILING_WHITESPACE = /\s$/;

/** The slice of the speech surface the composer's toolbar/strip render from. */
export interface ComposerSpeech {
	/** The still-changing interim transcript — preview only, never in `text`. */
	interim: string;
	listening: boolean;
	start: () => void;
	stop: () => void;
	supported: boolean;
}

/** Appends one final transcript segment to the draft, inserting a separating
 * space only when the draft doesn't already end in whitespace. */
export function appendTranscript(draft: string, segment: string): string {
	const text = segment.trim();
	if (text === "") {
		return draft;
	}
	if (draft === "" || TRAILING_WHITESPACE.test(draft)) {
		return draft + text;
	}
	return `${draft} ${text}`;
}

/** Owns the interim-preview state around `useSpeechInput`: interim results
 * update the preview, final results commit into the draft (and clear it). */
export function useComposerSpeech(
	setText: Dispatch<SetStateAction<string>>
): ComposerSpeech {
	const [interim, setInterim] = useState("");
	const speech = useSpeechInput({
		onTranscript: (transcript, isFinal) => {
			if (isFinal) {
				setInterim("");
				setText((draft) => appendTranscript(draft, transcript));
				return;
			}
			setInterim(transcript);
		},
	});
	return {
		interim,
		listening: speech.listening,
		start: () => {
			setInterim("");
			speech.start();
		},
		stop: () => {
			setInterim("");
			speech.stop();
		},
		supported: speech.supported,
	};
}

/** The mic toggle in the toolbar's left tools — hidden entirely where the
 * browser lacks SpeechRecognition, red-tinted + pulsing while listening. */
export function MicButton({
	disabled,
	speech,
}: {
	disabled: boolean;
	speech: ComposerSpeech;
}) {
	if (!speech.supported) {
		return null;
	}
	return (
		<Button
			aria-label="语音输入"
			aria-pressed={speech.listening}
			className={
				speech.listening ? "text-destructive hover:text-destructive" : undefined
			}
			disabled={disabled}
			onClick={speech.listening ? speech.stop : speech.start}
			size="icon-sm"
			title={speech.listening ? "停止语音输入" : "语音输入"}
			type="button"
			variant="ghost"
		>
			<MicIcon
				className={speech.listening ? "size-4 animate-pulse" : "size-4"}
			/>
		</Button>
	);
}

/** One-line muted/italic live preview of the interim transcript, rendered
 * between the textarea and the toolbar while the mic is listening. */
export function SpeechInterimStrip({ interim }: { interim: string }) {
	return (
		<output
			aria-live="polite"
			className="block truncate px-2 pb-1 text-muted-foreground text-xs italic"
		>
			🎙 {interim === "" ? "正在聆听…" : interim}
		</output>
	);
}

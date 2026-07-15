import { useEffect, useState } from "react";
import type { TextWhen } from "./agent-capabilities";
import type { TerminalComposerProps } from "./terminal-composer";
import type { ImageAttachments, ImageRef } from "./use-image-attachments";

// The composer's busy-mode pick plus the actual submit dispatch — moved out
// of terminal-composer.tsx (P2-T5) purely to keep that file under the repo's
// max-lines-per-file gate now that submit also feeds the web-side queue.

/** The default busy-turn send policy — every new turn starts here, and a
 * submit always resets back to it (see the `turnInFlight` effect and
 * `submit()` below): "don't persist a sticky 'interrupt'" per the brief. */
export const DEFAULT_WHEN: TextWhen = "queue";

export interface BusySendResult {
	setWhen: (when: TextWhen) => void;
	submit: () => void;
	when: TextWhen;
}

/** Where a submit goes. P2-T5: with a turn in flight and the default "queue"
 * policy, the text is HELD in the web-side queue (editable cards — see
 * use-web-queue.ts) instead of being relayed for the CLI/agent to queue
 * natively; it flushes on the busy→idle transition. "steer"/"interrupt"
 * picks — and any caller without a `webQueue` (unit tests) — keep the
 * immediate `onSend`, byte-identical to the pre-P2-T5 wire shape.
 * P3-T2: uploaded image refs (already consumed from the strip) ride whichever
 * path the submit takes. */
function dispatchSubmit(
	props: TerminalComposerProps,
	trimmed: string,
	when: TextWhen,
	images?: ImageRef[]
): void {
	// Arity-preserving throughout: an image-less submit calls onSend/enqueue
	// exactly like the pre-P3-T2 code, so tests/fakes asserting shapes hold.
	if (when !== DEFAULT_WHEN) {
		if (images) {
			props.onSend(trimmed, when, images);
		} else {
			props.onSend(trimmed, when);
		}
		return;
	}
	if ((props.turnInFlight ?? false) && props.webQueue) {
		if (images) {
			props.webQueue.enqueue(trimmed, images);
		} else {
			props.webQueue.enqueue(trimmed);
		}
		return;
	}
	if (images) {
		props.onSend(trimmed, undefined, images);
	} else {
		props.onSend(trimmed);
	}
}

/** Owns the busy-mode pick plus the actual submit dispatch/reset. Resets
 * back to the default "queue" both when a fresh turn starts AND after every
 * submit: "don't persist a sticky 'interrupt'" across turns per the brief. */
export function useBusySend(
	props: TerminalComposerProps,
	text: string,
	setText: (text: string) => void,
	images?: ImageAttachments
): BusySendResult {
	const { disabled, sending, turnInFlight } = props;
	const [when, setWhen] = useState<TextWhen>(DEFAULT_WHEN);

	useEffect(() => {
		if (turnInFlight) {
			setWhen(DEFAULT_WHEN);
		}
	}, [turnInFlight]);

	const submit = () => {
		const trimmed = text.trim();
		if (submitBlocked(disabled, sending, trimmed, images)) {
			return;
		}
		const refs = images?.takeRefs();
		dispatchSubmit(props, trimmed, when, refs?.length ? refs : undefined);
		setText("");
		setWhen(DEFAULT_WHEN);
	};

	return { setWhen, submit, when };
}

/** P3-T2: an image-only send (empty text, uploaded refs waiting) is allowed;
 * a send is blocked while any image upload is still in flight so a ref is
 * never silently missing from the batch. Split out of `submit` purely for
 * the repo's cyclomatic-complexity gate. */
function submitBlocked(
	disabled: boolean,
	sending: boolean,
	trimmed: string,
	images?: ImageAttachments
): boolean {
	if (disabled || sending || (images?.uploading ?? false)) {
		return true;
	}
	return trimmed === "" && (images?.pending.length ?? 0) === 0;
}

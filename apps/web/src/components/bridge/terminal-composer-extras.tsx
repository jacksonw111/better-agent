import type { ReactNode } from "react";
import type { TextWhen } from "./agent-capabilities";
import { BusyInputHint } from "./busy-input-hint";
import { AttachImageButton, ComposerImageStrip } from "./composer-image-strip";
import type { TerminalComposerProps } from "./terminal-composer";
import {
	ComposerToolbar,
	resolveToolbarProps,
} from "./terminal-composer-toolbar";
import type { ImageAttachments } from "./use-image-attachments";
import type { WebQueueItem } from "./use-web-queue";
import { WebQueueCards } from "./web-queue-cards";

// The composer's hint stack (queue cards / image strip / busy hint) and
// toolbar assembly — split out of terminal-composer.tsx purely to keep that
// file under the repo's 300-line cap after P3-T2 added the attach surface.

/** True only once a turn is actually in flight AND the agent supports more
 * than the bare default — with a single busy mode there's nothing to pick,
 * so the hint/dropdown would just be noise. */
function shouldShowBusyHint(props: TerminalComposerProps): boolean {
	return (props.turnInFlight ?? false) && (props.busyModes?.length ?? 0) > 1;
}

/** The web queue's cards, the image strip, and the busy-input hint row,
 * stacked in that order above the box. "Edit" loads the card's text back into
 * the composer (replacing the current draft) and removes the card. */
export function composerHint(
	props: TerminalComposerProps,
	busySend: { setWhen: (when: TextWhen) => void; when: TextWhen },
	setText: (text: string) => void,
	images?: ImageAttachments
): ReactNode {
	const onEdit = (item: WebQueueItem) => {
		setText(item.text);
		props.webQueue?.remove(item.id);
	};
	return (
		<>
			{props.webQueue && (
				<WebQueueCards
					items={props.webQueue.items}
					onEdit={onEdit}
					onRemove={(id) => props.webQueue?.remove(id)}
				/>
			)}
			{images && <ComposerImageStrip images={images} />}
			{shouldShowBusyHint(props) && (
				<BusyInputHint
					busyModes={props.busyModes ?? []}
					onWhenChange={busySend.setWhen}
					queuedCount={props.queuedCount}
					when={busySend.when}
				/>
			)}
		</>
	);
}

/** The toolbar with the attach button in its left slot when the attach
 * surface is enabled. */
export function composerToolbar(
	props: TerminalComposerProps,
	text: string,
	images?: ImageAttachments
): ReactNode {
	return (
		<ComposerToolbar
			{...resolveToolbarProps(props, text, images)}
			attachSlot={
				images && (
					<AttachImageButton
						addFiles={images.addFiles}
						disabled={props.disabled}
					/>
				)
			}
		/>
	);
}

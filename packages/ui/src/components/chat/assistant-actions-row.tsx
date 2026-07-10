import {
	Action,
	Actions,
	CopyAction,
} from "@better-agent/ui/components/actions";
import { ImageDownIcon } from "lucide-react";
import type { RefObject } from "react";
import type { ChatMessage } from "./chat-blocks";

/** App-supplied hook: hands off the message's rendered content node (text +
 * any genui charts/tables inside it) to a host-provided PNG export (e.g.
 * html-to-image), so this package doesn't need to depend on that library. */
export type SaveImageHandler = (params: {
	message: ChatMessage;
	node: HTMLElement;
}) => void;

function SaveImageAction({
	message,
	contentRef,
	onSaveImage,
}: {
	message: ChatMessage;
	contentRef: RefObject<HTMLDivElement | null>;
	onSaveImage: SaveImageHandler;
}) {
	return (
		<Action
			label="Save as image"
			onClick={() => {
				const node = contentRef.current;
				if (node) {
					onSaveImage({ message, node });
				}
			}}
		>
			<ImageDownIcon className="size-3.5" />
		</Action>
	);
}

/** The completed-answer actions row: copy text and (when the host supplies a
 * handler) save the answer — including any rendered genui charts — as a PNG.
 * Hidden until the turn is done and there's something to act on. */
export function AssistantActionsRow({
	message,
	fullText,
	contentRef,
	onSaveImage,
}: {
	message: ChatMessage;
	fullText: string;
	contentRef: RefObject<HTMLDivElement | null>;
	onSaveImage?: SaveImageHandler;
}) {
	if (
		message.status !== "complete" ||
		(fullText === "" && message.blocks.length === 0)
	) {
		return null;
	}
	return (
		<Actions>
			{fullText === "" ? null : <CopyAction text={fullText} />}
			{onSaveImage ? (
				<SaveImageAction
					contentRef={contentRef}
					message={message}
					onSaveImage={onSaveImage}
				/>
			) : null}
		</Actions>
	);
}

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import { Bubble, BubbleContent } from "@better-agent/ui/components/bubble";
import {
	Message,
	MessageAvatar,
	MessageContent,
} from "@better-agent/ui/components/message";
import { Response } from "@better-agent/ui/components/response";
import { UserIcon } from "lucide-react";

// S3-T2 (master spec §6.12/§18.4): the Task Opening Message is the FIRST
// visible message of every Task Conversation — the verbatim description
// (with /skill references left as text), the optional GitHub block and the
// short execution context, rendered as markdown in a user-shaped bubble.
// It's stored on the task at Start and never rewritten, so this row renders
// the same whether the run is still launching or long finished.

/** The Opening Message as a user-side chat row. Not a real relayed message —
 * it's the task's stored `openingMessage`, mounted as the feed's `leading`
 * slot (or standalone while the run has no session yet). */
export function OpeningMessageRow({
	avatarUrl,
	text,
}: {
	avatarUrl?: string;
	text: string;
}) {
	return (
		<Message align="end">
			<MessageAvatar>
				<Avatar>
					{avatarUrl ? <AvatarImage alt="user" src={avatarUrl} /> : null}
					<AvatarFallback>
						<UserIcon className="size-4" />
					</AvatarFallback>
				</Avatar>
			</MessageAvatar>
			<MessageContent>
				<Bubble align="end">
					<BubbleContent className="text-sm">
						<Response>{text}</Response>
					</BubbleContent>
				</Bubble>
			</MessageContent>
		</Message>
	);
}

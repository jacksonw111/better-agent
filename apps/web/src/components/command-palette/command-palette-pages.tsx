import { CommandGroup, CommandItem } from "@better-agent/ui/components/command";
import { useNavigate } from "@tanstack/react-router";
import { WEB_NAV_ITEMS } from "@/components/nav-items";

/** Runs an item's action and closes the palette (supplied by the shell). */
type RunAction = (action: () => void) => void;

function NavigateCommandGroup({ onRun }: { onRun: RunAction }) {
	const navigate = useNavigate();
	return (
		<CommandGroup heading="Go to">
			{WEB_NAV_ITEMS.map((item) => (
				<CommandItem
					key={item.to}
					onSelect={() => onRun(() => navigate({ to: item.to }))}
					value={`go to ${item.label}`}
				>
					<item.icon />
					{item.label}
				</CommandItem>
			))}
		</CommandGroup>
	);
}

/** The root (and only) page: app navigation. */
export function RootCommandPage({ onRun }: { onRun: RunAction }) {
	return <NavigateCommandGroup onRun={onRun} />;
}

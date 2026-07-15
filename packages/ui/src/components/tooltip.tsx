import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@better-agent/ui/lib/utils";

function TooltipProvider({
	delay = 200,
	...props
}: TooltipPrimitive.Provider.Props) {
	return (
		<TooltipPrimitive.Provider
			data-slot="tooltip-provider"
			delay={delay}
			{...props}
		/>
	);
}

// No per-tooltip Provider: delay grouping ("first hover waits, adjacent
// tooltips open instantly") only works across tooltips sharing ONE Provider —
// mount TooltipProvider once at the app shell (it carries the 200ms delay).
function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
	return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
	className,
	side = "top",
	sideOffset = 4,
	align = "center",
	...props
}: TooltipPrimitive.Popup.Props &
	Pick<TooltipPrimitive.Positioner.Props, "align" | "side" | "sideOffset">) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Positioner
				align={align}
				className="z-50"
				side={side}
				sideOffset={sideOffset}
			>
				<TooltipPrimitive.Popup
					className={cn(
						"data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 origin-(--transform-origin) rounded-md bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md ring-1 ring-foreground/10 duration-100 data-closed:animate-out data-open:animate-in",
						className
					)}
					data-slot="tooltip-content"
					{...props}
				/>
			</TooltipPrimitive.Positioner>
		</TooltipPrimitive.Portal>
	);
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };

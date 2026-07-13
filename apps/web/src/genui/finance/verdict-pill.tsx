import { cn } from "@better-agent/ui/lib/utils";
import type { LucideIcon } from "lucide-react";

// Generalizes divergence-card's SignalBadge (§2 Primitive Kit: VerdictPill)
// into a shared headline-verdict pill: any archetype that needs to surface a
// semantic-color conclusion (SignalCard's 顶背离/底背离/多头共振/空头共振,
// and future verdict-bearing cards) renders this instead of reinventing the
// tinted-pill markup per component.

const ICON_SIZE = 18;
/** ~10% opacity hex suffix for the colored-pill background tint — matches
 * divergence-card's BADGE_BG_ALPHA. */
const BG_ALPHA_HEX = "1a";

export interface VerdictPillProps {
	className?: string;
	/** `null`/`undefined` renders the neutral chip (no verdict color yet, or
	 * a genuinely neutral verdict like 中性/数据不足). */
	color?: string | null;
	icon: LucideIcon;
	label: string;
}

/** Semantic-color verdict pill: a `color` tints the background at ~10%
 * alpha and colors both the icon and label text; no `color` falls back to
 * the standard neutral chip. Borderless (§5.1), sized to read as the card's
 * headline rather than another stat among many. */
export function VerdictPill({
	className,
	color,
	icon: Icon,
	label,
}: VerdictPillProps) {
	return (
		<div
			className={cn(
				"flex w-fit items-center gap-2 rounded-full px-3 py-2",
				!color && "bg-muted/40 text-muted-foreground",
				className
			)}
			style={
				color
					? { backgroundColor: `${color}${BG_ALPHA_HEX}`, color }
					: undefined
			}
		>
			<Icon size={ICON_SIZE} />
			<span className="font-semibold text-sm">{label}</span>
		</div>
	);
}

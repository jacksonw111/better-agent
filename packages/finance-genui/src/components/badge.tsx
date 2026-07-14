import { cva, type VariantProps } from "class-variance-authority";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../lib/cn";

// Minimal self-contained Badge (was `@better-agent/ui/components/badge`, which
// pulled in @base-ui/react). The finance renderers only ever use a plain
// text badge with a `variant` + optional `className`/`style`, so this is a
// simple `<span>` with the same variant classes — no base-ui, no render prop.

const badgeVariants = cva(
	"inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border border-transparent px-2 py-0.5 font-medium text-xs",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground",
				secondary: "bg-secondary text-secondary-foreground",
				destructive: "bg-destructive/10 text-destructive",
				outline: "border-border text-foreground",
				ghost: "hover:bg-muted hover:text-muted-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	}
);

export function Badge({
	className,
	variant = "default",
	style,
	children,
}: {
	children?: ReactNode;
	className?: string;
	style?: CSSProperties;
} & VariantProps<typeof badgeVariants>) {
	return (
		<span className={cn(badgeVariants({ variant }), className)} style={style}>
			{children}
		</span>
	);
}

export { badgeVariants };

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className joiner — the finance-genui components' one styling
 * helper. Self-contained (was `@better-agent/ui/lib/utils`) so this package
 * has no dependency on the private web UI package and can be published. */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

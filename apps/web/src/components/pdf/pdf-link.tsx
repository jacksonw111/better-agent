"use client";

import { cn } from "@better-agent/ui/lib/utils";
import { FileTextIcon } from "lucide-react";
import { usePdfVault } from "./pdf-vault-context";

/** The consistent "open this PDF in the Vault" affordance every finance card
 * uses (定期报告 / 研报 …). Clicking pulls up the shared full-screen drawer. */
export function PdfLink({
	pdfUrl,
	title,
	label = "PDF",
	className,
}: {
	className?: string;
	label?: string;
	pdfUrl: string;
	title?: string;
}) {
	const vault = usePdfVault();
	return (
		<button
			className={cn(
				"inline-flex w-fit items-center gap-1 text-primary text-xs hover:underline",
				className
			)}
			onClick={() => vault.open(pdfUrl, title)}
			type="button"
		>
			<FileTextIcon className="size-3.5" />
			{label}
		</button>
	);
}

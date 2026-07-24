import { Button } from "@better-agent/ui/components/button";
import { Label } from "@better-agent/ui/components/label";
import { Response } from "@better-agent/ui/components/response";
import { Textarea } from "@better-agent/ui/components/textarea";
import { useState } from "react";

const DEFAULT_ROWS = 8;

/** A markdown textarea with a Write/Preview toggle — reused by the standard
 * body and the template's project CLAUDE.md. Preview renders through the same
 * `Response` (Streamdown) component the chat uses, so authored rules read
 * exactly as they will elsewhere. */
export function MarkdownField({
	id,
	label,
	value,
	onChange,
	placeholder,
	rows = DEFAULT_ROWS,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	rows?: number;
}) {
	const [preview, setPreview] = useState(false);
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between">
				<Label htmlFor={id}>{label}</Label>
				<Button
					onClick={() => setPreview((current) => !current)}
					size="xs"
					type="button"
					variant="ghost"
				>
					{preview ? "Write" : "Preview"}
				</Button>
			</div>
			{preview ? (
				<div className="min-h-24 rounded-md bg-muted/40 p-3">
					{value.trim() ? (
						<Response>{value}</Response>
					) : (
						<p className="text-muted-foreground text-sm">Nothing to preview.</p>
					)}
				</div>
			) : (
				<Textarea
					id={id}
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					rows={rows}
					value={value}
				/>
			)}
		</div>
	);
}

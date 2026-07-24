import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { Textarea } from "@better-agent/ui/components/textarea";
import { PlusIcon, XIcon } from "lucide-react";
import type { ScaffoldFile } from "./template-form";

const FILE_ROWS = 3;

function FileRow({
	file,
	index,
	onChange,
	onRemove,
}: {
	file: ScaffoldFile;
	index: number;
	onChange: (patch: Partial<ScaffoldFile>) => void;
	onRemove: () => void;
}) {
	return (
		<div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-3">
			<div className="flex items-center gap-2">
				<Input
					aria-label={`File ${index + 1} path`}
					onChange={(event) => onChange({ path: event.target.value })}
					placeholder="path e.g. README.md"
					value={file.path}
				/>
				<Button
					aria-label={`Remove file ${index + 1}`}
					onClick={onRemove}
					size="icon-xs"
					type="button"
					variant="ghost"
				>
					<XIcon className="size-4" />
				</Button>
			</div>
			<Textarea
				aria-label={`File ${index + 1} content`}
				onChange={(event) => onChange({ content: event.target.value })}
				placeholder="file contents"
				rows={FILE_ROWS}
				value={file.content}
			/>
		</div>
	);
}

function FilesEditor({
	files,
	onChange,
}: {
	files: ScaffoldFile[];
	onChange: (files: ScaffoldFile[]) => void;
}) {
	const update = (index: number, patch: Partial<ScaffoldFile>) =>
		onChange(
			files.map((file, i) => (i === index ? { ...file, ...patch } : file))
		);
	return (
		<div className="flex flex-col gap-2">
			<Label>Files</Label>
			{files.map((file, index) => (
				<FileRow
					file={file}
					index={index}
					// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, no stable id
					key={index}
					onChange={(patch) => update(index, patch)}
					onRemove={() => onChange(files.filter((_, i) => i !== index))}
				/>
			))}
			<Button
				className="self-start"
				onClick={() => onChange([...files, { content: "", path: "" }])}
				size="xs"
				type="button"
				variant="outline"
			>
				<PlusIcon className="size-4" />
				Add file
			</Button>
		</div>
	);
}

function DirsEditor({
	dirs,
	onChange,
}: {
	dirs: string[];
	onChange: (dirs: string[]) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<Label>Directories</Label>
			{dirs.map((dir, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, no stable id
				<div className="flex items-center gap-2" key={index}>
					<Input
						aria-label={`Directory ${index + 1}`}
						onChange={(event) =>
							onChange(
								dirs.map((d, i) => (i === index ? event.target.value : d))
							)
						}
						placeholder="dir e.g. src"
						value={dir}
					/>
					<Button
						aria-label={`Remove directory ${index + 1}`}
						onClick={() => onChange(dirs.filter((_, i) => i !== index))}
						size="icon-xs"
						type="button"
						variant="ghost"
					>
						<XIcon className="size-4" />
					</Button>
				</div>
			))}
			<Button
				className="self-start"
				onClick={() => onChange([...dirs, ""])}
				size="xs"
				type="button"
				variant="outline"
			>
				<PlusIcon className="size-4" />
				Add directory
			</Button>
		</div>
	);
}

/** The plain scaffold editor: add/remove file rows (path + content) and
 * directory rows. Blank rows are dropped on save (see toTemplateInput). */
export function ScaffoldEditor({
	files,
	dirs,
	onFilesChange,
	onDirsChange,
}: {
	files: ScaffoldFile[];
	dirs: string[];
	onFilesChange: (files: ScaffoldFile[]) => void;
	onDirsChange: (dirs: string[]) => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			<FilesEditor files={files} onChange={onFilesChange} />
			<DirsEditor dirs={dirs} onChange={onDirsChange} />
		</div>
	);
}

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Dropzone } from "@better-agent/ui/components/dropzone";
import { UploadList } from "@better-agent/ui/components/upload";
import type { DocumentUpload } from "./use-document-upload";

/** The upload modal: dropzone + live per-file progress. Upload state lives in
 * the page (useDocumentUpload), so closing the modal never interrupts
 * in-flight uploads — they keep going and the list refreshes as they land. */
export function UploadDialog({
	onOpenChange,
	open,
	upload,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	upload: DocumentUpload;
}) {
	const handleOpenChange = (next: boolean) => {
		if (!next) {
			upload.dismissSettled();
		}
		onOpenChange(next);
	};
	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Upload documents</DialogTitle>
					<DialogDescription>
						Interrupted uploads resume from where they left off — re-select the
						same file to continue after a reload.
					</DialogDescription>
				</DialogHeader>
				<Dropzone
					hint="Up to 200 MB per file"
					onFiles={(files) => {
						for (const file of files) {
							upload.start(file);
						}
					}}
				/>
				<UploadList
					className="max-h-64 overflow-y-auto"
					items={upload.uploads.map((item) => ({
						id: item.id,
						name: item.file.name,
						size: item.file.size,
						progress: item.progress,
						status: item.status,
						error: item.error,
					}))}
					onCancel={upload.cancel}
					onRetry={upload.retry}
				/>
			</DialogContent>
		</Dialog>
	);
}

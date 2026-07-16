const BYTE_UNIT = 1024;
const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** "1.4 MB"-style human size, shared by upload UIs and file lists. */
export function formatBytes(bytes: number): string {
	let value = bytes;
	let unitIndex = 0;
	while (value >= BYTE_UNIT && unitIndex < BYTE_UNITS.length - 1) {
		value /= BYTE_UNIT;
		unitIndex += 1;
	}
	const rounded = unitIndex === 0 ? value : Number(value.toFixed(1));
	return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}

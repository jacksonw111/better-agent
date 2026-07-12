// Minimal ambient types for @novnc/novnc (1.7.0 ships no declarations). Only
// the surface the VncViewer component uses is declared here: the RFB
// constructor, the `disconnect()` method, and the `connect`/`disconnect`
// EventTarget events. The package's `exports` is the bare string
// "./core/rfb.js", so the only importable specifier is the package root.
declare module "@novnc/novnc" {
	export interface RFBOptions {
		credentials?: { username?: string; password?: string; target?: string };
		shared?: boolean;
		wsProtocols?: string[];
	}

	export default class RFB extends EventTarget {
		constructor(
			target: HTMLElement,
			urlOrChannel: string | WebSocket,
			options?: RFBOptions
		);
		viewOnly: boolean;
		scaleViewport: boolean;
		resizeSession: boolean;
		background: string;
		disconnect(): void;
	}
}

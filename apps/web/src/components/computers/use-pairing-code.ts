import { useMutation } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

/** Creates a one-time pairing code (`computers.createPairingCode`). Split out
 * of the dialog so the component file stays presentational and the error
 * surface (toast) is injected rather than baked in. */
export function usePairingCodeMutation(onError: (message: string) => void) {
	return useMutation(
		orpc.computers.createPairingCode.mutationOptions({
			onError: (error: Error) => onError(error.message),
		})
	);
}

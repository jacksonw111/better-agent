import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingRow } from "@/components/setting-row";
import { orpc } from "@/utils/orpc";
import {
	disablePush,
	enablePush,
	getCurrentPushSubscription,
	isPushSupported,
} from "@/utils/push-subscription";

// P3-T3: the quick-settings "推送通知" switch — registers the SW and a push
// subscription on enable, tears both down on disable (utils/push-subscription
// .ts). Hidden entirely when the browser can't do Web Push (non-HTTPS, no SW/
// Push API); disabled with a hint when the server has no VAPID keys.

/** Flips push on/off and returns the resulting enabled state. Permission
 * denial toasts here (an expected user choice); anything else throws to the
 * caller's toast. */
async function togglePush(next: boolean, vapidKey: string): Promise<boolean> {
	if (!next) {
		await disablePush();
		return false;
	}
	const result = await enablePush(vapidKey);
	if (result === "permission-denied") {
		toast.error("浏览器已拒绝通知权限，请在浏览器设置中允许后重试");
		return false;
	}
	return true;
}

/** The support gate: renders nothing until an after-mount check confirms the
 * browser can do Web Push (SSR and the first client render agree on hidden),
 * and only then mounts the query-bearing inner row — so an unsupported
 * browser never even fetches the VAPID key. */
export function PushNotificationsRow() {
	const [supported, setSupported] = useState(false);
	useEffect(() => {
		setSupported(isPushSupported());
	}, []);
	if (!supported) {
		return null;
	}
	return <PushNotificationsRowInner />;
}

function PushNotificationsRowInner() {
	const [enabled, setEnabled] = useState(false);
	const [busy, setBusy] = useState(false);
	const keyQuery = useQuery({
		...orpc.pushSubscriptions.vapidPublicKey.queryOptions(),
		meta: { silent: true },
	});
	// Sync the switch to the browser's actual subscription state on mount.
	useEffect(() => {
		getCurrentPushSubscription()
			.then((subscription) => setEnabled(subscription !== null))
			.catch(() => undefined);
	}, []);
	const vapidKey = keyQuery.data?.key ?? null;
	const configured = vapidKey !== null;
	const handleChange = (next: boolean) => {
		if (busy || vapidKey === null) {
			return;
		}
		setBusy(true);
		togglePush(next, vapidKey)
			.then(setEnabled)
			.catch((err: unknown) => {
				toast.error(err instanceof Error ? err.message : String(err));
			})
			.finally(() => setBusy(false));
	};
	return (
		<>
			<SettingRow
				checked={enabled}
				disabled={!configured || busy || keyQuery.isPending}
				label="推送通知"
				onCheckedChange={handleChange}
			/>
			{keyQuery.isSuccess && !configured && (
				<p className="px-1.5 pb-1 text-muted-foreground text-xs">
					服务端未配置推送（VAPID 密钥缺失）
				</p>
			)}
		</>
	);
}

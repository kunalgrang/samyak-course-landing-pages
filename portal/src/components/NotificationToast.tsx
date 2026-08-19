import { useEffect } from "react";

export type NotificationKind = "success" | "error";

export type AppNotification = {
  id: number;
  kind: NotificationKind;
  message: string;
};

export function NotificationToast({
  notification,
  onDismiss,
  durationMs = 3600,
}: {
  notification: AppNotification | null;
  onDismiss: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    if (!notification) return undefined;
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, notification, onDismiss]);

  if (!notification) return null;

  return (
    <div className={`notification-toast notification-toast--${notification.kind}`} role={notification.kind === "error" ? "alert" : "status"} aria-live={notification.kind === "error" ? "assertive" : "polite"}>
      <strong>{notification.kind === "error" ? "Could not save" : "Saved"}</strong>
      <span>{notification.message}</span>
    </div>
  );
}

export function nextNotification(kind: NotificationKind, message: string, previous?: AppNotification | null): AppNotification {
  return {
    id: (previous?.id || 0) + 1,
    kind,
    message,
  };
}

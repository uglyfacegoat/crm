"use client";

import { useEffect } from "react";

export function PushSessionRestore() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) ||
      !("Notification" in window) || Notification.permission !== "granted") return;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) return;
        await fetch("/api/v1/push/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
          credentials: "same-origin",
        });
      } catch { /* An unavailable browser push service must not block CRM. */ }
    })();
  }, []);
  return null;
}

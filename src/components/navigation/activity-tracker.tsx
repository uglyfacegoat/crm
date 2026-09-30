"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { screenForPath } from "@/lib/member-activity";

export function ActivityTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const screen = screenForPath(pathname);
    if (!screen) return;
    let lastInteraction = Date.now();
    const markInteraction = () => { lastInteraction = Date.now(); };
    const tick = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus() || Date.now() - lastInteraction > 5 * 60_000) return;
      void fetch("/api/v1/profile/activity", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screen }), credentials: "same-origin", keepalive: true,
      }).catch(() => {});
    };
    document.addEventListener("pointerdown", markInteraction);
    document.addEventListener("keydown", markInteraction);
    document.addEventListener("scroll", markInteraction, { passive: true });
    const interval = window.setInterval(tick, 30_000);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("pointerdown", markInteraction);
      document.removeEventListener("keydown", markInteraction);
      document.removeEventListener("scroll", markInteraction);
    };
  }, [pathname]);
  return null;
}

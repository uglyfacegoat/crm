"use client";

import { useLayoutEffect, useRef, type HTMLAttributes, type RefObject } from "react";

type AnchorRef = RefObject<HTMLElement | null>;

// The browser's top layer escapes overflow and transformed cards while keeping
// the menu in its original DOM: form submission, keyboard handlers and Dialog's
// focus trap still see the controls as descendants of their trigger.
export function FloatingLayer({
  anchorRef, anchorSelector, placement = "bottom", align = "start", width = "anchor",
  maxHeight = 320, gap = 8, children, className = "", ...attributes
}: HTMLAttributes<HTMLDivElement> & {
  anchorRef: AnchorRef; anchorSelector?: string; placement?: "top" | "bottom";
  align?: "start" | "center" | "end"; width?: number | "anchor" | "content";
  maxHeight?: number; gap?: number;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const root = anchorRef.current;
    const anchor = anchorSelector ? root?.querySelector<HTMLElement>(anchorSelector) : root;
    if (!layer || !anchor) return;
    layer.showPopover();
    let frame = 0;
    const position = () => {
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 12;
      const topEdge = (viewport?.offsetTop ?? 0) + 12;
      const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 24;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 24;
      const rect = anchor.getBoundingClientRect();
      let visible = anchor.getClientRects().length > 0 && rect.bottom > topEdge && rect.top < bottomEdge && rect.right > leftEdge && rect.left < rightEdge;
      for (let parent = anchor.parentElement; visible && parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (rect.bottom <= bounds.top || rect.top >= bounds.bottom)) visible = false;
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (rect.right <= bounds.left || rect.left >= bounds.right)) visible = false;
      }
      layer.style.visibility = visible ? "visible" : "hidden";
      if (!visible) return;
      const roomWidth = Math.max(1, rightEdge - leftEdge);
      layer.style.width = width === "content" ? "max-content" : `${Math.min(width === "anchor" ? rect.width : width, roomWidth)}px`;
      layer.style.maxWidth = `${roomWidth}px`;
      layer.style.maxHeight = `${Math.min(maxHeight, bottomEdge - topEdge)}px`;
      const naturalHeight = Math.min(layer.scrollHeight + 2, maxHeight);
      const below = Math.max(0, bottomEdge - rect.bottom - gap), above = Math.max(0, rect.top - topEdge - gap);
      const preferredRoom = placement === "top" ? above : below;
      const upwards = preferredRoom >= naturalHeight ? placement === "top" : above > below;
      layer.style.maxHeight = `${Math.min(maxHeight, upwards ? above : below)}px`;
      const size = layer.getBoundingClientRect();
      const left = align === "center" ? rect.left + (rect.width - size.width) / 2 : align === "end" ? rect.right - size.width : rect.left;
      layer.style.left = `${Math.max(leftEdge, Math.min(left, rightEdge - size.width))}px`;
      layer.style.top = `${Math.max(topEdge, Math.min(upwards ? rect.top - gap - size.height : rect.bottom + gap, bottomEdge - size.height))}px`;
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
    position();
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor); observer.observe(layer); observer.observe(document.documentElement);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
      if (layer.matches(":popover-open")) layer.hidePopover();
    };
  }, [anchorRef, anchorSelector, placement, align, width, maxHeight, gap]);
  return <div {...attributes} ref={layerRef} popover="manual" data-floating-layer
    onToggle={event => event.stopPropagation()}
    className={`floating-layer ${className}`}
    style={{ position: "fixed", inset: "auto", margin: 0, overflowY: "auto", ...attributes.style }}>
    {children}
  </div>;
}

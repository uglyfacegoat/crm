"use client";

import { useState } from "react";
import { getInitials } from "@/lib/format";

type AvatarProps = {
  name: string;
  size?: "sm" | "md" | "lg";
  tone?: "lime" | "violet" | "mint";
  src?: string;
  className?: string;
};

const tones = {
  lime: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  violet: "bg-[var(--support-soft)] text-[var(--support-strong)]",
  mint: "bg-[var(--info-bg)] text-[var(--info)]",
};

export function Avatar({ name, size = "md", tone = "violet", src, className = "" }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${
        size === "sm" ? "size-7 text-[9px]" : size === "lg" ? "size-16 text-lg" : "size-9 text-[11px]"
      } ${tones[tone]} ${className}`}
    >
      {getInitials(name)}
      {src && src !== failedSrc ? <img src={src} alt="" onLoad={() => setLoadedSrc(src)} onError={() => setFailedSrc(src)}
        className={`absolute inset-0 size-full rounded-full object-cover ${loadedSrc === src ? "opacity-100" : "opacity-0"}`} /> : null}
    </span>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";

export function DashboardPanelLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`focus-ring flex items-center justify-end gap-3 border-t border-[var(--line)] px-5 py-3.5 text-right text-[11px] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--surface-soft)] ${className}`}
    >
      <span>{children}</span>
    </Link>
  );
}

import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
      className={`focus-ring flex items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3.5 text-[11px] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--surface-soft)] ${className}`}
    >
      <span>{children}</span>
      <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
    </Link>
  );
}

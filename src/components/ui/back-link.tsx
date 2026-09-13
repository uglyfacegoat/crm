import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export function BackLink({
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
      className={`focus-ring inline-flex w-fit items-center gap-2 rounded-lg text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--text)] ${className}`}
    >
      <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </Link>
  );
}

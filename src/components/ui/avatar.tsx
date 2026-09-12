import { getInitials } from "@/lib/format";

type AvatarProps = {
  name: string;
  size?: "sm" | "md";
  tone?: "lime" | "violet" | "mint";
};

const tones = {
  lime: "bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  violet: "bg-[var(--support-soft)] text-[var(--support-strong)]",
  mint: "bg-[var(--info-bg)] text-[var(--info)]",
};

export function Avatar({ name, size = "md", tone = "violet" }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${
        size === "sm" ? "size-7 text-[9px]" : "size-9 text-[11px]"
      } ${tones[tone]}`}
    >
      {getInitials(name)}
    </span>
  );
}

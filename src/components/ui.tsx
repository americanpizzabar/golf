"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LanguageToggle, useT } from "@/lib/i18n";

export function PageHeader({
  title,
  subtitle,
  back,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  return (
    <header className="px-4 pt-5 pb-3 flex items-center gap-3">
      {back && (
        <button
          onClick={() => router.back()}
          className="btn btn-ghost w-9 h-9 grid place-items-center text-lg"
          aria-label={t("戻る")}
        >
          ‹
        </button>
      )}
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
            {subtitle}
          </p>
        )}
      </div>
      <LanguageToggle className="ml-auto self-start" />
    </header>
  );
}

export function Card({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`card p-4 ${className}`} style={style}>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  unit,
  accent = "var(--green)",
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  accent?: string;
}) {
  return (
    <div className="card p-3 text-center">
      <div className="text-[11px]" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div className="mt-1 font-bold text-2xl" style={{ color: accent }}>
        {value}
        {unit && <span className="text-xs ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

const sevColor: Record<string, string> = {
  high: "var(--red)",
  mid: "var(--amber)",
  low: "var(--cyan)",
};
const sevLabel: Record<string, string> = {
  high: "要改善",
  mid: "注意",
  low: "軽度",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const t = useT();
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: sevColor[severity] + "22", color: sevColor[severity] }}
    >
      {sevLabel[severity] ? t(sevLabel[severity]) : severity}
    </span>
  );
}

export function LinkCard({
  href,
  icon,
  title,
  desc,
  accent = "var(--green)",
}: {
  href: string;
  icon: string;
  title: string;
  desc: string;
  accent?: string;
}) {
  return (
    <Link href={href} className="card p-4 flex items-center gap-3 active:scale-[0.99]">
      <div
        className="w-11 h-11 rounded-2xl grid place-items-center text-2xl shrink-0"
        style={{ background: accent + "22" }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-xs truncate" style={{ color: "var(--muted)" }}>
          {desc}
        </div>
      </div>
      <div className="ml-auto text-xl" style={{ color: "var(--muted)" }}>
        ›
      </div>
    </Link>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
      <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      {label}
    </div>
  );
}

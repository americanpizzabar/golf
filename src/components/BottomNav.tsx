"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n";

const items = [
  { href: "/", label: "ホーム", icon: "🏠" },
  { href: "/swing", label: "スイング", icon: "🏌️" },
  { href: "/approach", label: "アプローチ", icon: "🎯" },
  { href: "/coach", label: "コーチ", icon: "🧠" },
  { href: "/progress", label: "記録", icon: "📈" },
];

export default function BottomNav() {
  const path = usePathname();
  const t = useT();
  return (
    <nav className="tabbar">
      <div className="flex justify-around items-stretch px-1 py-1.5">
        {items.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className="flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-xl"
              style={{ color: active ? "var(--green)" : "var(--muted)" }}
            >
              <span className="text-xl leading-none">{it.icon}</span>
              <span className="text-[10px] font-semibold">{t(it.label)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

"use client";

import { PageHeader, Card } from "@/components/ui";
import { HOME_DRILLS, youtubeSearch } from "@/lib/golf";

const TAG_LABEL: Record<string, string> = {
  home: "自宅",
  mobility: "柔軟",
};

export default function HomeDrillsPage() {
  const total = HOME_DRILLS.reduce((s, d) => s + d.minutes, 0);
  return (
    <main>
      <PageHeader title="自宅ノンボール練習" subtitle="鏡の前・1畳でできるメニュー" back />
      <div className="px-4 space-y-4">
        <Card className="relative overflow-hidden">
          <div className="absolute -right-6 -top-8 w-28 h-28 rounded-full opacity-20" style={{ background: "#06b6d4" }} />
          <div className="text-sm">
            練習場に行けない日も、ボールなしで上達。<br />
            <span style={{ color: "var(--muted)" }}>全{HOME_DRILLS.length}種・合計約{total}分</span>
          </div>
        </Card>

        <div className="space-y-2">
          {HOME_DRILLS.map((d, i) => (
            <Card key={i}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-2xl grid place-items-center text-lg shrink-0" style={{ background: "#06b6d422" }}>
                  {["🪞", "🌀", "🏌️", "🧘", "🏐"][i % 5]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold">{d.title}</div>
                    {TAG_LABEL[d.tag] && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--bg-soft)", color: "var(--cyan)" }}>
                        {TAG_LABEL[d.tag]}
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{d.desc}</div>
                  <div className="text-xs mt-1.5 inline-block px-2 py-0.5 rounded-full" style={{ background: "var(--bg-soft)", color: "var(--cyan)" }}>
                    💡 {d.cue}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: "var(--muted)" }}>
                    <span>⏱ {d.minutes}分</span>
                    <a href={youtubeSearch(d.videoQuery)} target="_blank" rel="noopener noreferrer" className="ml-auto" style={{ color: "var(--green)" }}>
                      ▶ 参考動画
                    </a>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}

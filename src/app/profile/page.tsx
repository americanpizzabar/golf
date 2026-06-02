"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/components/ui";
import { fetchPros, getProfile, upsertProfile } from "@/lib/db";
import { matchPro } from "@/lib/swing";
import type { Pro, Profile } from "@/lib/types";

export default function ProfilePage() {
  const [pros, setPros] = useState<Pro[]>([]);
  const [form, setForm] = useState({
    nickname: "",
    height_cm: "" as string,
    arm_length_cm: "" as string,
    shoulder_width_cm: "" as string,
    leg_length_cm: "" as string,
    dominant_hand: "right",
  });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [pr, p] = await Promise.all([fetchPros(), getProfile()]);
      setPros(pr);
      if (p) {
        setForm({
          nickname: p.nickname ?? "",
          height_cm: p.height_cm?.toString() ?? "",
          arm_length_cm: p.arm_length_cm?.toString() ?? "",
          shoulder_width_cm: p.shoulder_width_cm?.toString() ?? "",
          leg_length_cm: p.leg_length_cm?.toString() ?? "",
          dominant_hand: p.dominant_hand ?? "right",
        });
      }
      setLoading(false);
    })();
  }, []);

  const num = (s: string) => (s === "" ? null : Number(s));
  const body = {
    height_cm: num(form.height_cm),
    arm_length_cm: num(form.arm_length_cm),
    shoulder_width_cm: num(form.shoulder_width_cm),
    leg_length_cm: num(form.leg_length_cm),
  };
  const match = form.height_cm ? matchPro(pros, body) : null;

  async function save() {
    const profile: Partial<Profile> = {
      nickname: form.nickname || null,
      ...body,
      dominant_hand: form.dominant_hand,
      matched_pro_id: match?.pro.id ?? null,
    };
    await upsertProfile(profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const field = (
    key: keyof typeof form,
    label: string,
    placeholder: string,
    hint?: string,
  ) => (
    <label className="block">
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        value={form[key] as string}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full px-3 py-2.5 mt-1"
      />
      {hint && (
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>
          {hint}
        </span>
      )}
    </label>
  );

  return (
    <main>
      <PageHeader title="体型・骨格プロフィール" subtitle="あなたに近いプロを自動選定" back />
      <div className="px-4 space-y-4">
        <Card className="space-y-3">
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              ニックネーム
            </span>
            <input
              value={form.nickname}
              placeholder="ゴルファー名"
              onChange={(e) => setForm({ ...form, nickname: e.target.value })}
              className="w-full px-3 py-2.5 mt-1"
            />
          </label>
          {field("height_cm", "身長 (cm)", "172")}
          <div className="grid grid-cols-2 gap-3">
            {field("arm_length_cm", "腕の長さ (cm)", "76", "肩〜手首")}
            {field("shoulder_width_cm", "肩幅 (cm)", "45")}
          </div>
          {field("leg_length_cm", "脚の長さ (cm)", "90", "股下")}
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              利き手
            </span>
            <select
              value={form.dominant_hand}
              onChange={(e) => setForm({ ...form, dominant_hand: e.target.value })}
              className="w-full px-3 py-2.5 mt-1"
            >
              <option value="right">右打ち</option>
              <option value="left">左打ち</option>
            </select>
          </label>
        </Card>

        {match && (
          <Card>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              骨格シンクロ・ランキング
            </div>
            <div className="mt-2 space-y-2">
              {match.ranking.slice(0, 4).map((r, i) => (
                <div key={r.pro.id} className="flex items-center gap-3">
                  <div
                    className="w-7 h-7 rounded-full grid place-items-center text-xs font-bold shrink-0"
                    style={{ background: r.pro.accent + "33", color: r.pro.accent }}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{r.pro.name}</div>
                    <div className="h-1.5 rounded-full mt-1" style={{ background: "var(--line)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${r.sync}%`, background: r.pro.accent }}
                      />
                    </div>
                  </div>
                  <div className="text-sm font-bold" style={{ color: r.pro.accent }}>
                    {r.sync}%
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <button
          onClick={save}
          disabled={loading || !form.height_cm}
          className="btn btn-primary w-full py-3.5 disabled:opacity-50"
        >
          {saved ? "保存しました ✓" : "保存して理想のプロを確定"}
        </button>
      </div>
    </main>
  );
}

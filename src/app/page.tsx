"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, Stat, LinkCard, Card } from "@/components/ui";
import { fetchPros, getProfile, fetchSwings, fetchApproaches } from "@/lib/db";
import type { Pro, Profile, Swing, ApproachSession } from "@/lib/types";

export default function Home() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pro, setPro] = useState<Pro | null>(null);
  const [swings, setSwings] = useState<Swing[]>([]);
  const [approaches, setApproaches] = useState<ApproachSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [pr, pros, sw, ap] = await Promise.all([
        getProfile(),
        fetchPros(),
        fetchSwings(20),
        fetchApproaches(200),
      ]);
      setProfile(pr);
      setSwings(sw);
      setApproaches(ap);
      if (pr?.matched_pro_id) setPro(pros.find((p) => p.id === pr.matched_pro_id) ?? null);
      setLoading(false);
    })();
  }, []);

  const latest = swings[0];
  const apAtt = approaches.reduce((s, a) => s + a.attempts, 0);
  const apIn = approaches.reduce((s, a) => s + a.in_1m, 0);
  const apRate = apAtt ? Math.round((apIn / apAtt) * 100) : null;

  return (
    <main>
      <PageHeader
        title="SwingSync ⛳"
        subtitle={
          profile?.nickname
            ? `${profile.nickname}さん、今日も上達しよう`
            : "AIゴルフ・スイング分析"
        }
      />

      <div className="px-4 space-y-4">
        {/* Matched pro / setup prompt */}
        {profile?.height_cm && pro ? (
          <Card className="relative overflow-hidden">
            <div
              className="absolute -right-6 -top-8 w-32 h-32 rounded-full opacity-20"
              style={{ background: pro.accent }}
            />
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              あなたの理想のプロ（骨格マッチ）
            </div>
            <div className="mt-1 flex items-end justify-between">
              <div>
                <div className="text-lg font-bold">{pro.name}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {pro.style}
                </div>
              </div>
              <Link
                href="/profile"
                className="text-xs underline"
                style={{ color: "var(--green)" }}
              >
                体型を編集
              </Link>
            </div>
          </Card>
        ) : (
          <Link
            href="/profile"
            className="card p-4 flex items-center gap-3 active:scale-[0.99]"
          >
            <div
              className="w-11 h-11 rounded-2xl grid place-items-center text-2xl"
              style={{ background: "#22c55e22" }}
            >
              📏
            </div>
            <div>
              <div className="font-semibold">まず体型を登録</div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                身長・腕の長さからあなたに近いプロを自動選定します
              </div>
            </div>
            <div className="ml-auto text-xl" style={{ color: "var(--muted)" }}>
              ›
            </div>
          </Link>
        )}

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label="シンクロ率"
            value={latest?.sync_rate ?? "—"}
            unit={latest?.sync_rate ? "%" : ""}
            accent="var(--cyan)"
          />
          <Stat
            label="寄せ率(1m)"
            value={apRate ?? "—"}
            unit={apRate !== null ? "%" : ""}
            accent="var(--green)"
          />
          <Stat
            label="解析回数"
            value={loading ? "…" : swings.length}
            accent="var(--amber)"
          />
        </div>

        {latest && latest.faults?.length > 0 && (
          <Card>
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>
              直近スイングの一言診断
            </div>
            <div className="font-semibold">⚠️ {latest.faults[0].label}</div>
            <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              {latest.faults[0].detail}
            </div>
          </Card>
        )}

        {/* Feature nav */}
        <div className="space-y-2">
          <LinkCard
            href="/swing"
            icon="🏌️"
            title="スイングAI解析"
            desc="カメラで骨格計測・プロとのズレを可視化"
            accent="#22d3ee"
          />
          <LinkCard
            href="/approach"
            icon="🎯"
            title="アプローチ計測（ARターゲット）"
            desc="状況別の寄せ成功率をデータ化"
            accent="#22c55e"
          />
          <LinkCard
            href="/tracer"
            icon="🎥"
            title="AR弾道トレーサー"
            desc="球筋を判定・弾道を描画＋クラブ分布図"
            accent="#3b82f6"
          />
          <LinkCard
            href="/coach"
            icon="🧠"
            title="AIコーチ"
            desc="時間・球数に合わせた処方箋メニュー"
            accent="#f59e0b"
          />
          <LinkCard
            href="/progress"
            icon="📈"
            title="成長ログ & 1年後予測"
            desc="スイングを並べて比較・タイムラプス"
            accent="#8b5cf6"
          />
          <LinkCard
            href="/sync"
            icon="📡"
            title="シンクロ撮影（2台同時）"
            desc="2台を6桁コードで接続・正面×後方を同時録画"
            accent="#14b8a6"
          />
          <LinkCard
            href="/cross"
            icon="🎬"
            title="クロスアングル解析"
            desc="正面×後方を打音で同期・2視点で真因を判定"
            accent="#ec4899"
          />
          <LinkCard
            href="/ghost"
            icon="👻"
            title="ゴースト比較"
            desc="ベストスイングと重ねて加速を可視化"
            accent="#a78bfa"
          />
          <LinkCard
            href="/silhouette"
            icon="👤"
            title="シースルー・シルエット"
            desc="プロの輪郭と重ねてハミ出しを可視化"
            accent="#f59e0b"
          />
          <LinkCard
            href="/match"
            icon="🤝"
            title="一期一会ラウンド（対戦）"
            desc="同伴者とスコア・寄せ率を競う"
            accent="#ef4444"
          />
          <LinkCard
            href="/home-drills"
            icon="🪞"
            title="自宅ノンボール練習"
            desc="鏡の前・1畳でできるメニュー"
            accent="#06b6d4"
          />
          <LinkCard
            href="/conditions"
            icon="🌬️"
            title="弾道エミュレーター"
            desc="標高・気温・風で飛距離変化を予測"
            accent="#0ea5e9"
          />
        </div>

        <p
          className="text-center text-[11px] pt-2 pb-4"
          style={{ color: "var(--muted)" }}
        >
          骨格推定はブラウザ内（MediaPipe）で処理。映像は端末から送信されません。
        </p>
      </div>
    </main>
  );
}

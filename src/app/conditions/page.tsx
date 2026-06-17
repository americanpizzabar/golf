"use client";

import { useState } from "react";
import { PageHeader, Card, Stat, Spinner } from "@/components/ui";
import { useT } from "@/lib/i18n";

interface Cond {
  temp: number; // ℃
  pressure: number; // hPa (surface)
  elevation: number; // m
  windSpeed: number; // m/s
  windDir: number; // deg
  place?: string;
}

const RHO0 = 1.225; // 標準大気密度 (15℃, 1013.25hPa)

function airDensity(tempC: number, pressureHpa: number) {
  return (pressureHpa * 100) / (287.05 * (tempC + 273.15));
}

export default function ConditionsPage() {
  const t = useT();
  const [cond, setCond] = useState<Cond | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [baseCarry, setBaseCarry] = useState("130");
  const [wind, setWind] = useState<"none" | "head" | "tail" | "cross">("none");
  const [manual, setManual] = useState(false);
  const [mTemp, setMTemp] = useState("20");
  const [mElev, setMElev] = useState("0");
  const [mWind, setMWind] = useState("0");

  async function detect() {
    setErr("");
    if (!navigator.geolocation) {
      setErr(t("位置情報が利用できません。手動入力をご利用ください。"));
      setManual(true);
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=auto`;
          const res = await fetch(url);
          const data = await res.json();
          const c = data.current;
          setCond({
            temp: c.temperature_2m,
            pressure: c.surface_pressure,
            elevation: data.elevation ?? 0,
            windSpeed: c.wind_speed_10m,
            windDir: c.wind_direction_10m,
          });
          setLoading(false);
        } catch {
          setErr(t("気象データを取得できませんでした。手動入力をご利用ください。"));
          setManual(true);
          setLoading(false);
        }
      },
      () => {
        setErr(t("位置情報の取得が許可されませんでした。手動入力をご利用ください。"));
        setManual(true);
        setLoading(false);
      },
      { timeout: 8000 },
    );
  }

  function applyManual() {
    const elev = Number(mElev) || 0;
    // 標高から概算の気圧（標準大気: 海面1013.25hPa、-12hPa/100m 程度）
    const pressure = 1013.25 * Math.pow(1 - (0.0065 * elev) / 288.15, 5.255);
    setCond({
      temp: Number(mTemp) || 20,
      pressure,
      elevation: elev,
      windSpeed: Number(mWind) || 0,
      windDir: 0,
    });
    setErr("");
  }

  const base = Number(baseCarry) || 130;
  let calc: {
    rho: number;
    densityFactor: number;
    airCarry: number;
    airDelta: number;
    windDelta: number;
    finalCarry: number;
  } | null = null;
  if (cond) {
    const rho = airDensity(cond.temp, cond.pressure);
    const densityFactor = RHO0 / rho; // >1 = 薄い空気 = 飛ぶ
    const airCarry = base * Math.pow(densityFactor, 0.5);
    const airDelta = airCarry - base;
    const windDelta =
      wind === "head"
        ? -cond.windSpeed * 1.5 * (base / 130)
        : wind === "tail"
          ? cond.windSpeed * 1.1 * (base / 130)
          : 0;
    const finalCarry = airCarry + windDelta;
    calc = { rho, densityFactor, airCarry, airDelta, windDelta, finalCarry };
  }

  const windName = (d: number) => {
    const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
    return dirs[Math.round(d / 45) % 8];
  };

  return (
    <main>
      <PageHeader title={t("弾道エミュレーター")} subtitle={t("標高・気温・風で飛距離変化を予測")} back />
      <div className="px-4 space-y-4">
        <Card>
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
            {t("現在地の環境を取得して、いまの弾道がコースでどう変わるかを予測します。")}
          </div>
          {!manual ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={detect} disabled={loading} className="btn btn-primary py-3 disabled:opacity-50">
                {loading ? t("取得中…") : `📍 ${t("現在地で計測")}`}
              </button>
              <button onClick={() => setManual(true)} className="btn btn-ghost py-3">
                ✏️ {t("手動入力")}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{t("気温℃")}</span>
                  <input type="number" value={mTemp} onChange={(e) => setMTemp(e.target.value)} className="w-full px-2 py-2 mt-1" />
                </label>
                <label className="block">
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{t("標高m")}</span>
                  <input type="number" value={mElev} onChange={(e) => setMElev(e.target.value)} className="w-full px-2 py-2 mt-1" />
                </label>
                <label className="block">
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{t("風m/s")}</span>
                  <input type="number" value={mWind} onChange={(e) => setMWind(e.target.value)} className="w-full px-2 py-2 mt-1" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={applyManual} className="btn btn-primary py-2.5">{t("反映する")}</button>
                <button onClick={() => setManual(false)} className="btn btn-ghost py-2.5">{t("位置情報に戻す")}</button>
              </div>
            </div>
          )}
          {loading && <div className="mt-3"><Spinner label={t("気象データを取得中…")} /></div>}
          {err && <p className="text-xs mt-2" style={{ color: "var(--amber)" }}>{err}</p>}
        </Card>

        {cond && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t("気温")} value={cond.temp.toFixed(0)} unit="℃" accent="#f59e0b" />
              <Stat label={t("標高")} value={cond.elevation.toFixed(0)} unit="m" accent="#22d3ee" />
              <Stat label={t("気圧")} value={cond.pressure.toFixed(0)} unit="hPa" accent="var(--muted)" />
            </div>

            <Card>
              <label className="block mb-3">
                <span className="text-xs" style={{ color: "var(--muted)" }}>{t("基準キャリー（平地・無風での飛距離 m）")}</span>
                <input type="number" inputMode="numeric" value={baseCarry} onChange={(e) => setBaseCarry(e.target.value)} className="w-full px-3 py-2.5 mt-1" />
              </label>
              <div className="text-xs mb-1.5" style={{ color: "var(--muted)" }}>
                {t("風（{speed} m/s・{dir}の風）に対する向き", { speed: cond.windSpeed.toFixed(1), dir: t(windName(cond.windDir)) })}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {([["none", "無風換算"], ["head", "向かい"], ["tail", "追い"], ["cross", "横"]] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setWind(k)}
                    className="btn py-2 text-xs"
                    style={{
                      background: wind === k ? "var(--green)" : "var(--bg-soft)",
                      color: wind === k ? "#03260f" : "var(--fg)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </Card>

            {calc && (
              <Card className="relative overflow-hidden">
                <div className="absolute -right-8 -top-8 w-32 h-32 rounded-full opacity-20" style={{ background: "#22c55e" }} />
                <div className="text-xs" style={{ color: "var(--muted)" }}>{t("予測キャリー")}</div>
                <div className="text-4xl font-extrabold mt-1" style={{ color: "var(--green)" }}>
                  {calc.finalCarry.toFixed(0)}
                  <span className="text-xl"> m</span>
                  <span className="text-base font-semibold ml-2" style={{ color: calc.finalCarry >= base ? "var(--green)" : "var(--red)" }}>
                    {calc.finalCarry - base >= 0 ? "+" : ""}{(calc.finalCarry - base).toFixed(1)}m
                  </span>
                </div>
                <div className="mt-3 space-y-1.5 text-sm">
                  <Row label={t("気温・標高（空気密度）")} v={calc.airDelta} />
                  {wind !== "none" && wind !== "cross" && <Row label={wind === "head" ? t("向かい風") : t("追い風")} v={calc.windDelta} />}
                  {wind === "cross" && (
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      {t("横風はキャリーよりも左右のブレに影響します。狙いをズラして対応を。")}
                    </div>
                  )}
                </div>
                <p className="text-[11px] mt-3" style={{ color: "var(--muted)" }}>
                  {t("空気密度 {rho} kg/m³（標準比 {pct}%）。", { rho: calc.rho.toFixed(3), pct: (calc.densityFactor * 100).toFixed(0) })}
                  {calc.airDelta >= 0
                    ? t("空気が薄く飛びやすい環境です。グリーンで止まりにくい点に注意。")
                    : t("空気が重く飛びにくい環境です。")}
                </p>
                <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>
                  {t("※ 物理モデルによる概算値です。実際の弾道は打ち出し角・スピン量により変動します。")}
                </p>
              </Card>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Row({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span className="font-semibold" style={{ color: v >= 0 ? "var(--green)" : "var(--red)" }}>
        {v >= 0 ? "+" : ""}{v.toFixed(1)} m
      </span>
    </div>
  );
}

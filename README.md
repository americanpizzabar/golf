# SwingSync ⛳ — AIゴルフ・スイング分析アプリ

スマホのカメラだけで骨格を計測し、プロとのシンクロ率・悪癖・アプローチ成功率を可視化する
モバイルファーストのWebアプリ。Next.js (App Router) + Supabase で構築し、Vercel にデプロイできます。

## 主な機能

| # | 機能 | 説明 | 画面 |
|---|------|------|------|
| 1 | 骨格計測・AIスイング分析 | ブラウザ内 MediaPipe Pose で骨格を推定。アドレス/トップ/インパクト/フィニッシュの4ポジションを自動検出し、3Dワイヤーフレーム表示。スウェー・チキンウィング・アーリーリリース等を「一言原因」と何cm/何度のズレで提示。理想のプロとのシンクロ率を算出 | `/swing` `/profile` |
| 2 | アプローチ成功率・データ計測 | カメラに半径1m / 2m の AR ターゲットを重ね、タップで結果を記録。「平坦」「左足下がり」「ラフ」「バンカー」などライ状況別に成功率をグラフ化し、弱点を浮き彫りに | `/approach` |
| 3 | パーソナライズ練習メニュー（AIコーチ） | スイング診断とアプローチ弱点から、滞在時間（30〜120分）・球数に合わせた処方箋ドリルを自動生成。各ドリルに参考動画リンク付き | `/coach` |
| 4 | 成長ログ & 1年後予測 | シンクロ率の推移グラフ、最初↔最新のタイムラプス比較、ペースから1年後を予測 | `/progress` |
| 4 | 一期一会ラウンド（対戦モード） | 同伴者とスコア・寄せ率をその場で競うミニ・スコアカード | `/match` |
| 4 | 自宅ノンボール練習 | 鏡の前・1畳でできる素振り/パター/ストレッチメニュー | `/home-drills` |

## 技術スタック

- **Next.js 16**（App Router, TypeScript, Tailwind CSS v4）
- **@mediapipe/tasks-vision** — ブラウザ内で骨格推定（映像は端末外に送信されません）
- **Supabase** — Postgres + REST。ログイン不要の `device_id`（localStorage）方式
- **recharts** — グラフ表示

## セットアップ

```bash
npm install
npm run dev
```

`.env.local`（任意。未設定でも `src/lib/supabase.ts` のフォールバックで動作）:

```
NEXT_PUBLIC_SUPABASE_URL=https://fkxhneopceeblcpidxzb.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>
```

## データベース

Supabase プロジェクト `golf` に以下のテーブルを作成済み（RLS有効）:

- `pros` … プロの骨格・スイング基準データ（シード済み）
- `profiles` … ユーザーの体型・選定プロ
- `swings` … スイング解析結果（角度・欠点・シンクロ率）
- `approach_sessions` … 状況別アプローチ記録
- `practice_menus` … 生成された練習メニュー
- `rounds` … ラウンド（対戦）記録

## Vercel へのデプロイ

このリポジトリを Vercel に連携すると自動ビルドされます。Supabase の接続情報は
ソース内のフォールバックに含まれているため追加設定なしで動作しますが、本番では
プロジェクト設定の Environment Variables に上記2つを設定することを推奨します。

> 注: スイング解析・アプローチのカメラ機能はカメラ権限と HTTPS が必要です（Vercel は HTTPS 提供）。

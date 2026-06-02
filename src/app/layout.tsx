import type { Metadata, Viewport } from "next";
import "./globals.css";
import BottomNav from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "SwingSync — AIゴルフ分析",
  description:
    "スマホのカメラでスイングを骨格解析。理想のプロとのシンクロ率、アプローチ成功率、AIコーチの練習メニューまで。",
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full">
        <div className="app-shell">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import { LanguageProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "SwingSync — AI Golf Analysis",
  description:
    "Analyze your swing from your phone camera with pose tracking. Sync rate vs. your ideal pro, approach success rate, and AI coaching menus.",
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
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <LanguageProvider>
          <div className="app-shell">{children}</div>
          <BottomNav />
        </LanguageProvider>
      </body>
    </html>
  );
}

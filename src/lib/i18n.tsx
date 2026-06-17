"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { EN } from "./i18n-dict";

// Lightweight i18n. Source-as-key: the Japanese text written in the components
// IS the translation key. English is the DEFAULT and comes from the EN
// dictionary; Japanese mode returns the key verbatim (so it can never regress).
// Missing English entries fall back to the Japanese source — never a blank.

export type Lang = "en" | "ja";
const STORAGE_KEY = "golf_lang";
const LANG_EVENT = "golf_lang_change";

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
}
const LangCtx = createContext<Ctx>({ lang: "en", setLang: () => {} });

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// The persisted language is an external store (localStorage). Reading it via
// useSyncExternalStore keeps server ("en") and client hydration consistent
// without a setState-in-effect, and updates every subscriber on change.
function readLang(): Lang {
  if (typeof localStorage === "undefined") return "en";
  return localStorage.getItem(STORAGE_KEY) === "ja" ? "ja" : "en";
}
function subscribeLang(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LANG_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(LANG_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const lang = useSyncExternalStore<Lang>(subscribeLang, readLang, () => "en");

  // Keep the document language attribute in sync (updating an external system).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined") window.dispatchEvent(new Event(LANG_EVENT));
  }, []);

  return <LangCtx.Provider value={{ lang, setLang }}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}

// Translator hook. Usage: const t = useT(); t("こんにちは"), t("{n}番目", { n }).
export function useT() {
  const { lang } = useContext(LangCtx);
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      if (lang === "ja") return interpolate(key, vars);
      return interpolate(EN[key] ?? key, vars);
    },
    [lang],
  );
}

// Pure translator for non-hook contexts (given an explicit lang).
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  if (lang === "ja") return interpolate(key, vars);
  return interpolate(EN[key] ?? key, vars);
}

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div
      className={`inline-flex rounded-full overflow-hidden text-[11px] font-bold shrink-0 ${className}`}
      style={{ border: "1px solid var(--line)" }}
      role="group"
      aria-label="Language"
    >
      {(["en", "ja"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className="px-2.5 py-1 leading-none"
          style={{
            background: lang === l ? "var(--green)" : "transparent",
            color: lang === l ? "#03260f" : "var(--muted)",
          }}
          aria-pressed={lang === l}
        >
          {l === "en" ? "EN" : "日本語"}
        </button>
      ))}
    </div>
  );
}

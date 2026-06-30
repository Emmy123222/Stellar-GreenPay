/**
 * components/LanguageSwitcher.tsx — Dropdown to switch between EN/ES/FR.
 */
import { useI18n } from "@/lib/i18n";

const LANGS = [
  { code: "en" as const, label: "English", flag: "🇺🇸" },
  { code: "es" as const, label: "Español", flag: "🇪🇸" },
  { code: "fr" as const, label: "Français", flag: "🇫🇷" },
];

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as "en" | "es" | "fr")}
      className="text-xs bg-forest-50 border border-forest-200 rounded-lg px-2 py-1.5 text-forest-700 font-body cursor-pointer focus:outline-none focus:ring-2 focus:ring-forest-300"
      aria-label="Select language"
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.flag} {l.label}
        </option>
      ))}
    </select>
  );
}

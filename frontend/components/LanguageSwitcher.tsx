/**
 * components/LanguageSwitcher.tsx — adds EN/ES locale picker.
 */
import { useI18n } from "@/lib/i18n";

const LOCALES = [
  { code: "en" as const, label: "English", flag: "🇺🇸" },
  { code: "es" as const, label: "Español", flag: "🇪🇸" },
  { code: "fr" as const, label: "Français", flag: "🇫🇷" },
];

export default function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as typeof LOCALES[number]["code"])}
      className="text-sm bg-[#f0f7f0] dark:bg-[#0e1f13] border border-[rgba(34,114,57,0.20)] dark:border-[rgba(96,208,123,0.25)]
                 text-[#227239] dark:text-[#81c784] rounded-lg px-2 py-1.5
                 focus:outline-none focus:ring-2 focus:ring-[rgba(34,114,57,0.30)] dark:focus:ring-[rgba(96,208,123,0.40)]"
      aria-label="Language"
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.flag} {l.label}
        </option>
      ))}
    </select>
  );
}

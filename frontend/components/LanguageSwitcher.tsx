/** Select a display language using each language's own name. */
import { isLocale, useI18n } from "@/lib/i18n";

const LOCALES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "ar", label: "العربية" },
];

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();

  return (
    <select
      value={locale}
      onChange={(event) => {
        if (isLocale(event.target.value)) setLocale(event.target.value);
      }}
      className="text-sm bg-forest-50 dark:bg-forest-900 border border-[rgba(34,114,57,0.20)] dark:border-[rgba(96,208,123,0.25)]
                 text-forest-500 dark:text-forest-300 rounded-lg px-2 py-1.5
                 focus:outline-none focus:ring-2 focus:ring-[rgba(34,114,57,0.30)] dark:focus:ring-[rgba(96,208,123,0.40)]"
      aria-label={t("common.language")}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code} lang={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

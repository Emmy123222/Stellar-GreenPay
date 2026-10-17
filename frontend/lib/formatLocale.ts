/**
 * lib/formatLocale.ts
 * Centralized locale-aware number, currency, unit, rank, and date formatting helpers.
 */

let formattingLocale = "en-US";

export function setFormattingLocale(locale: string): void {
  formattingLocale = locale;
}

export function getFormattingLocale(): string {
  return formattingLocale;
}

export function resolveLocale(locale?: string): string {
  return locale || formattingLocale || "en-US";
}

/**
 * Format a generic number with Intl.NumberFormat options.
 */
export function formatNumber(
  value: number | string,
  options?: Intl.NumberFormatOptions,
  locale?: string,
): string {
  const n = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : Number(value);
  if (isNaN(n) || !Number.isFinite(n)) return "0";
  const loc = resolveLocale(locale);
  return new Intl.NumberFormat(loc, options).format(n);
}

/**
 * Normalize an XLM amount to 7 decimal places (1 stroop = 0.0000001 XLM).
 */
export function normalizeXLMAmount(amount: number | string): string {
  const n = typeof amount === "string" ? parseFloat(amount.replace(/,/g, "")) : Number(amount);
  if (isNaN(n) || !Number.isFinite(n)) return "0.0000000";
  return n.toFixed(7);
}

/**
 * Format a numeric amount with locale separators and configurable fractional digits.
 */
export function formatAmount(
  amount: number | string,
  decimals = 2,
  locale?: string,
  minDecimals?: number,
): string {
  const n = typeof amount === "string" ? parseFloat(amount.replace(/,/g, "")) : Number(amount);
  if (isNaN(n) || !Number.isFinite(n)) return "0";
  const minimumFractionDigits =
    minDecimals !== undefined ? minDecimals : (n % 1 === 0 ? 0 : Math.min(2, decimals));
  return formatNumber(
    n,
    {
      minimumFractionDigits,
      maximumFractionDigits: decimals,
    },
    locale,
  );
}

export interface FormatXLMOptions extends Intl.NumberFormatOptions {
  decimals?: number;
  minDecimals?: number;
  locale?: string;
  asCurrency?: boolean;
}

/**
 * Format an amount as XLM with locale separators and Intl currency/unit options.
 */
export function formatXLM(
  amount: number | string,
  options?: number | FormatXLMOptions,
  locale?: string,
): string {
  const n = typeof amount === "string" ? parseFloat(amount.replace(/,/g, "")) : Number(amount);
  if (isNaN(n) || !Number.isFinite(n)) return "0 XLM";

  const opts: FormatXLMOptions = typeof options === "number" ? { decimals: options } : (options ?? {});
  const loc = resolveLocale(locale ?? opts.locale);

  if (opts.asCurrency || opts.style === "currency") {
    const { decimals, minDecimals, locale: _l, asCurrency: _ac, ...restOptions } = opts;
    return new Intl.NumberFormat(loc, {
      style: "currency",
      currency: "XLM",
      currencyDisplay: opts.currencyDisplay ?? "name",
      minimumFractionDigits: minDecimals ?? (decimals !== undefined ? Math.min(2, decimals) : 2),
      maximumFractionDigits: decimals ?? 2,
      ...restOptions,
    }).format(n);
  }

  const decimals = opts.decimals !== undefined ? opts.decimals : 2;
  const minDec = opts.minDecimals !== undefined ? opts.minDecimals : (n % 1 === 0 ? 0 : decimals);
  const { decimals: _d, minDecimals: _md, locale: _l, asCurrency: _ac, unit: _u, ...restOptions } = opts;
  const formatted = formatNumber(
    n,
    {
      minimumFractionDigits: minDec,
      maximumFractionDigits: decimals,
      ...restOptions,
    },
    loc,
  );
  return `${formatted} XLM`;
}

export interface FormatTonneOptions extends Intl.NumberFormatOptions {
  decimals?: number;
  minDecimals?: number;
  locale?: string;
  unitDisplay?: "short" | "narrow" | "long";
  includeCO2?: boolean;
}

/**
 * Format CO2 tonnes with Intl number formatting and localized unit labels.
 */
export function formatTonnes(
  amount: number | string,
  options?: number | FormatTonneOptions,
  locale?: string,
): string {
  const n = typeof amount === "string" ? parseFloat(amount.replace(/,/g, "")) : Number(amount);
  if (isNaN(n) || !Number.isFinite(n)) return "0 tonnes";

  const opts: FormatTonneOptions = typeof options === "number" ? { decimals: options } : (options ?? {});
  const loc = resolveLocale(locale ?? opts.locale);
  const decimals = opts.decimals !== undefined ? opts.decimals : 2;
  const minDec = opts.minDecimals !== undefined ? opts.minDecimals : 0;

  const {
    decimals: _d,
    minDecimals: _md,
    locale: _l,
    unitDisplay = "long",
    includeCO2,
    unit: _u,
    asCurrency: _ac,
    ...restOptions
  } = opts;
  const formatted = formatNumber(
    n,
    {
      minimumFractionDigits: minDec,
      maximumFractionDigits: decimals,
      ...restOptions,
    },
    loc,
  );

  const isShort = unitDisplay === "short" || unitDisplay === "narrow";
  if (isShort) {
    return includeCO2 ? `${formatted} t CO₂` : `${formatted} t`;
  }

  const norm = loc.toLowerCase();
  if (norm.startsWith("es")) {
    const word = Math.abs(n) === 1 ? "tonelada" : "toneladas";
    return includeCO2 ? `${formatted} ${word} de CO₂` : `${formatted} ${word}`;
  }
  if (norm.startsWith("fr")) {
    const word = Math.abs(n) === 1 ? "tonne" : "tonnes";
    return includeCO2 ? `${formatted} ${word} de CO₂` : `${formatted} ${word}`;
  }
  const word = Math.abs(n) === 1 ? "tonne" : "tonnes";
  return includeCO2 ? `${formatted} ${word} CO₂` : `${formatted} ${word}`;
}

export interface FormatCO2Options extends Intl.NumberFormatOptions {
  unit?: "kg" | "tonne" | "tonnes" | "t" | "auto";
  decimals?: number;
  minDecimals?: number;
  locale?: string;
  unitDisplay?: "short" | "narrow" | "long";
}

/**
 * Format a CO₂ amount (in kilograms or tonnes) into a compact human-readable string.
 */
export function formatCO2(
  kgOrTonnes: number | string,
  options?: FormatCO2Options,
  locale?: string,
): string {
  const n = typeof kgOrTonnes === "string" ? parseFloat(kgOrTonnes.replace(/,/g, "")) : Number(kgOrTonnes);
  if (isNaN(n) || !Number.isFinite(n)) return "0 kg CO₂";

  const loc = resolveLocale(locale ?? options?.locale);

  if (options?.unit === "tonne" || options?.unit === "tonnes" || options?.unit === "t") {
    return formatTonnes(n / 1000, {
      ...options,
      includeCO2: true,
      unitDisplay: options.unit === "t" ? "short" : options.unitDisplay ?? "long",
    }, loc);
  }

  if (n >= 1_000_000) {
    return `${formatAmount(n / 1_000_000, options?.decimals ?? 1, loc, options?.minDecimals ?? 1)}M kg CO₂`;
  }
  if (n >= 1_000) {
    return `${formatAmount(n / 1_000, options?.decimals ?? 1, loc, options?.minDecimals ?? 1)}k kg CO₂`;
  }
  return `${formatAmount(n, options?.decimals ?? 0, loc, options?.minDecimals ?? 0)} kg CO₂`;
}

/**
 * Format a leaderboard rank using locale-aware digits and format.
 */
export function formatRank(rank: number | string, locale?: string): string {
  const n = typeof rank === "string" ? parseFloat(rank.replace(/,/g, "")) : Number(rank);
  if (isNaN(n) || !Number.isFinite(n)) return `#${rank}`;
  const loc = resolveLocale(locale);
  return `#${formatNumber(n, { maximumFractionDigits: 0 }, loc)}`;
}

/**
 * Format an XLM amount into an approximate fiat currency equivalent (USD, EUR, BRL).
 */
export function formatFiatEquivalent(
  xlmAmount: string | number,
  rate: number | null,
  currency: "USD" | "EUR" | "BRL" = "USD",
  locale?: string,
): string | null {
  if (rate === null || rate <= 0) return null;
  const n = typeof xlmAmount === "string" ? parseFloat(xlmAmount.replace(/,/g, "")) : xlmAmount;
  if (isNaN(n) || !isFinite(n)) return null;
  const fiatVal = n * rate;
  const formatted = formatAmount(fiatVal, 2, locale, 2);

  switch (currency) {
    case "EUR":
      return `≈ €${formatted} EUR`;
    case "BRL":
      return `≈ R$ ${formatted} BRL`;
    case "USD":
    default:
      return `≈ $${formatted} USD`;
  }
}

/**
 * Convert an XLM amount into an approximate USD string.
 */
export function formatUSDEquivalent(
  xlmAmount: string | number,
  price: number | null,
  locale?: string,
): string | null {
  return formatFiatEquivalent(xlmAmount, price, "USD", locale);
}

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(value);
}

export function formatDate(
  d: string | Date,
  locale?: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(resolveLocale(locale), options).format(toDate(d));
  } catch {
    return typeof d === "string" ? d : String(d);
  }
}

export function formatDateTime(d: string | Date, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(resolveLocale(locale), {
      dateStyle: "short",
      timeStyle: "short",
    }).format(toDate(d));
  } catch {
    return typeof d === "string" ? d : String(d);
  }
}

export function formatTime(d: string | Date, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(resolveLocale(locale), {
      hour: "numeric",
      minute: "2-digit",
    }).format(toDate(d));
  } catch {
    return typeof d === "string" ? d : String(d);
  }
}

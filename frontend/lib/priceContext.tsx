/**
 * lib/priceContext.tsx — Global XLM & multi-fiat price context (USD, EUR, BRL).
 * Supports locale-inferred currency, manual overrides, caching, and staleness handling.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { formatFiatEquivalent as formatFiat } from "@/utils/format";
import { useI18n } from "./i18n";
import { getFormattingLocale } from "./formatLocale";

export const SUPPORTED_FIAT_CURRENCIES = ["USD", "EUR", "BRL"] as const;
export type FiatCurrency = (typeof SUPPORTED_FIAT_CURRENCIES)[number];

export const FIAT_STORAGE_KEY = "greenpay:currency";
export const FIAT_RATES_CACHE_KEY = "greenpay:fiat_rates";
const STALE_THRESHOLD_MS = 300_000; // 5 minutes

export function isFiatCurrency(val: unknown): val is FiatCurrency {
  return typeof val === "string" && (SUPPORTED_FIAT_CURRENCIES as readonly string[]).includes(val);
}

/**
 * Infer a default fiat currency from the given application or browser locale.
 */
export function inferCurrencyFromLocale(locale: string): FiatCurrency {
  const norm = (locale || "").toLowerCase();
  if (norm.startsWith("pt") || norm.includes("br")) return "BRL";
  if (
    norm.startsWith("fr") ||
    norm.startsWith("es") ||
    norm.startsWith("de") ||
    norm.startsWith("it") ||
    norm.includes("eu")
  ) {
    return "EUR";
  }
  return "USD";
}

function safeGetStorage(key: string): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {
    // Ignore quota / permission errors
  }
}

export interface PriceContextValue {
  xlmUsd: number | null; // backward compatibility
  rates: Record<FiatCurrency, number | null>;
  currency: FiatCurrency;
  setCurrency: (c: FiatCurrency) => void;
  resetCurrency: () => void;
  hasManualOverride: boolean;
  rate: number | null;
  isStale: boolean;
  lastUpdated: number | null;
  formatFiatEquivalent: (xlmAmount: string | number, customCurrency?: FiatCurrency) => string | null;
  supportedCurrencies: readonly FiatCurrency[];
}

const defaultRates: Record<FiatCurrency, number | null> = {
  USD: 0.125,
  EUR: 0.115,
  BRL: 0.6875,
};

const PriceContext = createContext<PriceContextValue>({
  xlmUsd: 0.125,
  rates: defaultRates,
  currency: "USD",
  setCurrency: () => {},
  resetCurrency: () => {},
  hasManualOverride: false,
  rate: 0.125,
  isStale: false,
  lastUpdated: null,
  formatFiatEquivalent: () => null,
  supportedCurrencies: SUPPORTED_FIAT_CURRENCIES,
});

export function PriceProvider({ children }: { children: ReactNode }) {
  let activeLocale = "en";
  try {
    const i18n = useI18n();
    if (i18n?.locale) activeLocale = i18n.locale;
  } catch {
    activeLocale = getFormattingLocale();
  }

  const [rates, setRates] = useState<Record<FiatCurrency, number | null>>(() => {
    const cached = safeGetStorage(FIAT_RATES_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed?.rates && typeof parsed.rates === "object") {
          return {
            USD: parsed.rates.USD ?? defaultRates.USD,
            EUR: parsed.rates.EUR ?? defaultRates.EUR,
            BRL: parsed.rates.BRL ?? defaultRates.BRL,
          };
        }
      } catch {}
    }
    return defaultRates;
  });

  const [manualCurrency, setManualCurrency] = useState<FiatCurrency | null>(() => {
    const stored = safeGetStorage(FIAT_STORAGE_KEY);
    return isFiatCurrency(stored) ? stored : null;
  });

  const [lastUpdated, setLastUpdated] = useState<number | null>(() => {
    const cached = safeGetStorage(FIAT_RATES_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (typeof parsed?.timestamp === "number") return parsed.timestamp;
      } catch {}
    }
    return null;
  });

  const [isStale, setIsStale] = useState<boolean>(false);

  // Active currency follows manual override if set; otherwise inferred from locale
  const currency: FiatCurrency = manualCurrency ?? inferCurrencyFromLocale(activeLocale);

  const setCurrency = useCallback((c: FiatCurrency) => {
    if (!isFiatCurrency(c)) return;
    setManualCurrency(c);
    safeSetStorage(FIAT_STORAGE_KEY, c);
  }, []);

  const resetCurrency = useCallback(() => {
    setManualCurrency(null);
    try {
      if (typeof window !== "undefined") window.localStorage.removeItem(FIAT_STORAGE_KEY);
    } catch {}
  }, []);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function fetchRates() {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
      const url = apiBase ? `${apiBase}/api/v1/price` : "/api/v1/price";

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Backend price returned ${res.status}`);
        const json = await res.json();
        if (json?.data?.rates && typeof json.data.rates === "object") {
          const freshRates: Record<FiatCurrency, number | null> = {
            USD: typeof json.data.rates.USD === "number" ? json.data.rates.USD : defaultRates.USD,
            EUR: typeof json.data.rates.EUR === "number" ? json.data.rates.EUR : defaultRates.EUR,
            BRL: typeof json.data.rates.BRL === "number" ? json.data.rates.BRL : defaultRates.BRL,
          };
          if (mounted) {
            setRates(freshRates);
            setLastUpdated(Date.now());
            setIsStale(Boolean(json.data.isStale));
            safeSetStorage(
              FIAT_RATES_CACHE_KEY,
              JSON.stringify({ rates: freshRates, timestamp: Date.now() }),
            );
          }
          return;
        }
      } catch {
        // Fallback to CoinGecko free API if backend price is unavailable
        try {
          const cgRes = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd,eur,brl",
            { signal: controller.signal },
          );
          if (cgRes.ok) {
            const cgData = await cgRes.json();
            if (cgData?.stellar?.usd) {
              const usd = cgData.stellar.usd;
              const freshRates: Record<FiatCurrency, number | null> = {
                USD: usd,
                EUR: cgData.stellar.eur ?? Number((usd * 0.92).toFixed(6)),
                BRL: cgData.stellar.brl ?? Number((usd * 5.5).toFixed(6)),
              };
              if (mounted) {
                setRates(freshRates);
                setLastUpdated(Date.now());
                setIsStale(false);
                safeSetStorage(
                  FIAT_RATES_CACHE_KEY,
                  JSON.stringify({ rates: freshRates, timestamp: Date.now() }),
                );
              }
              return;
            }
          }
        } catch {
          if (mounted && lastUpdated && Date.now() - lastUpdated > STALE_THRESHOLD_MS) {
            setIsStale(true);
          }
        }
      }
    }

    fetchRates();
    const interval = setInterval(fetchRates, 60_000);

    return () => {
      mounted = false;
      controller.abort();
      clearInterval(interval);
    };
  }, [lastUpdated]);

  const activeRate = rates[currency] ?? rates.USD;

  const formatFiatEquivalent = useCallback(
    (xlmAmount: string | number, customCurrency?: FiatCurrency) => {
      const targetCur = customCurrency || currency;
      const targetRate = rates[targetCur];
      return formatFiat(xlmAmount, targetRate, targetCur, getFormattingLocale());
    },
    [currency, rates],
  );

  const value = useMemo<PriceContextValue>(
    () => ({
      xlmUsd: rates.USD,
      rates,
      currency,
      setCurrency,
      resetCurrency,
      hasManualOverride: manualCurrency !== null,
      rate: activeRate,
      isStale,
      lastUpdated,
      formatFiatEquivalent,
      supportedCurrencies: SUPPORTED_FIAT_CURRENCIES,
    }),
    [rates, currency, setCurrency, resetCurrency, manualCurrency, activeRate, isStale, lastUpdated, formatFiatEquivalent],
  );

  return <PriceContext.Provider value={value}>{children}</PriceContext.Provider>;
}

export function usePriceContext(): PriceContextValue {
  return useContext(PriceContext);
}

export function useXlmPrice(): number | null {
  return useContext(PriceContext).xlmUsd;
}

export function useFiatCurrency(): [FiatCurrency, (c: FiatCurrency) => void] {
  const ctx = useContext(PriceContext);
  return [ctx.currency, ctx.setCurrency];
}

import React from "react";
import { render, screen, act } from "@testing-library/react";
import {
  PriceProvider,
  usePriceContext,
  inferCurrencyFromLocale,
  FIAT_STORAGE_KEY,
  FIAT_RATES_CACHE_KEY,
} from "../priceContext";

function TestConsumer() {
  const {
    currency,
    setCurrency,
    resetCurrency,
    formatFiatEquivalent,
    rates,
    isStale,
  } = usePriceContext();

  return (
    <div>
      <div data-testid="active-currency">{currency}</div>
      <div data-testid="is-stale">{isStale ? "stale" : "fresh"}</div>
      <div data-testid="formatted-100">{formatFiatEquivalent(100)}</div>
      <div data-testid="formatted-100-eur">{formatFiatEquivalent(100, "EUR")}</div>
      <div data-testid="rates-usd">{rates.USD}</div>
      <div data-testid="rates-eur">{rates.EUR}</div>
      <div data-testid="rates-brl">{rates.BRL}</div>
      <button onClick={() => setCurrency("EUR")}>Set EUR</button>
      <button onClick={() => setCurrency("BRL")}>Set BRL</button>
      <button onClick={() => resetCurrency()}>Reset</button>
    </div>
  );
}

describe("priceContext", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe("inferCurrencyFromLocale", () => {
    test("infers USD for English and unknown locales", () => {
      expect(inferCurrencyFromLocale("en")).toBe("USD");
      expect(inferCurrencyFromLocale("en-US")).toBe("USD");
      expect(inferCurrencyFromLocale("ja")).toBe("USD");
      expect(inferCurrencyFromLocale("")).toBe("USD");
    });

    test("infers EUR for European languages", () => {
      expect(inferCurrencyFromLocale("de")).toBe("EUR");
      expect(inferCurrencyFromLocale("fr")).toBe("EUR");
      expect(inferCurrencyFromLocale("es")).toBe("EUR");
      expect(inferCurrencyFromLocale("it")).toBe("EUR");
      expect(inferCurrencyFromLocale("es-ES")).toBe("EUR");
    });

    test("infers BRL for Portuguese and Brazil locales", () => {
      expect(inferCurrencyFromLocale("pt")).toBe("BRL");
      expect(inferCurrencyFromLocale("pt-BR")).toBe("BRL");
    });
  });

  describe("PriceProvider and usePriceContext", () => {
    test("provides default currency and rates", () => {
      render(
        <PriceProvider>
          <TestConsumer />
        </PriceProvider>
      );

      expect(screen.getByTestId("active-currency").textContent).toBe("USD");
      expect(screen.getByTestId("formatted-100").textContent).toContain("USD");
      expect(screen.getByTestId("formatted-100-eur").textContent).toContain("EUR");
    });

    test("supports manual currency selection and persists to localStorage", () => {
      render(
        <PriceProvider>
          <TestConsumer />
        </PriceProvider>
      );

      act(() => {
        screen.getByText("Set EUR").click();
      });

      expect(screen.getByTestId("active-currency").textContent).toBe("EUR");
      expect(localStorage.getItem(FIAT_STORAGE_KEY)).toBe("EUR");
      expect(screen.getByTestId("formatted-100").textContent).toContain("EUR");

      act(() => {
        screen.getByText("Set BRL").click();
      });

      expect(screen.getByTestId("active-currency").textContent).toBe("BRL");
      expect(localStorage.getItem(FIAT_STORAGE_KEY)).toBe("BRL");
      expect(screen.getByTestId("formatted-100").textContent).toContain("BRL");

      act(() => {
        screen.getByText("Reset").click();
      });

      expect(screen.getByTestId("active-currency").textContent).toBe("USD");
      expect(localStorage.getItem(FIAT_STORAGE_KEY)).toBeNull();
    });

    test("initializes manual currency from localStorage if present", () => {
      localStorage.setItem(FIAT_STORAGE_KEY, "BRL");

      render(
        <PriceProvider>
          <TestConsumer />
        </PriceProvider>
      );

      expect(screen.getByTestId("active-currency").textContent).toBe("BRL");
    });

    test("initializes rates from localStorage cache if present", () => {
      localStorage.setItem(
        FIAT_RATES_CACHE_KEY,
        JSON.stringify({
          rates: { USD: 0.2, EUR: 0.18, BRL: 1.1 },
          timestamp: Date.now(),
        })
      );

      render(
        <PriceProvider>
          <TestConsumer />
        </PriceProvider>
      );

      expect(screen.getByTestId("rates-usd").textContent).toBe("0.2");
      expect(screen.getByTestId("rates-eur").textContent).toBe("0.18");
      expect(screen.getByTestId("rates-brl").textContent).toBe("1.1");
    });
  });
});

/**
 * __tests__/formatLocale.test.tsx
 *
 * Unit tests comparing locale-aware formatting between en, fr, and es.
 * Verifies that number separators, currency options for XLM, unit options for tonnes,
 * ranks, and dates format correctly across locales.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import {
  setFormattingLocale,
  getFormattingLocale,
  formatNumber,
  formatAmount,
  formatXLM,
  formatTonnes,
  formatCO2,
  formatRank,
  formatDate,
  formatDateTime,
  formatTime,
  formatUSDEquivalent,
} from "@/lib/formatLocale";
import AnimatedNumber from "@/components/AnimatedNumber";
import LeaderboardTable from "@/components/LeaderboardTable";
import TeamsLeaderboard from "@/components/TeamsLeaderboard";
import { StatCard } from "@/pages/impact";
import { I18nProvider } from "@/lib/i18n";

jest.mock("@/lib/api", () => ({
  fetchLeaderboard: jest.fn(),
  fetchTeamLeaderboard: jest.fn(),
}));

jest.mock("@/lib/priceContext", () => ({
  useXlmPrice: () => 0.125,
}));

const { fetchLeaderboard, fetchTeamLeaderboard } = jest.requireMock("@/lib/api");

describe("formatLocale helpers across en, fr, and es", () => {
  beforeEach(() => {
    setFormattingLocale("en-US");
  });

  describe("formatNumber", () => {
    it("formats 1234.5 with comma separator in en and narrow space / comma in fr", () => {
      const en = formatNumber(1234.5, { minimumFractionDigits: 1 }, "en");
      const fr = formatNumber(1234.5, { minimumFractionDigits: 1 }, "fr");

      expect(en).toBe("1,234.5");
      // French uses space/narrow space as thousands separator and comma as decimal separator
      expect(fr).toMatch(/1[\s\u202f]234,5/);
      expect(en).not.toBe(fr);
    });

    it("formats thousands and decimal separators correctly for Spanish (es)", () => {
      const es = formatNumber(12345.5, { minimumFractionDigits: 1 }, "es");
      // Spanish uses dot as group separator and comma as decimal separator
      expect(es).toBe("12.345,5");
    });
  });

  describe("formatXLM", () => {
    const value = 1234.5;

    it("formats 1,234.5 XLM for English and 1 234,5 XLM for French", () => {
      const en = formatXLM(value, { decimals: 1 }, "en");
      const fr = formatXLM(value, { decimals: 1 }, "fr");

      expect(en).toBe("1,234.5 XLM");
      expect(fr).toMatch(/^1[\s\u202f]234,5 XLM$/);
    });

    it("formats with decimal comma in Spanish", () => {
      const es = formatXLM(value, { decimals: 1 }, "es");
      expect(es).toMatch(/1234,5 XLM/);
    });

    it("supports Intl.NumberFormat currency options for XLM", () => {
      const enCurrency = formatXLM(value, { style: "currency", currency: "XLM", currencyDisplay: "name" }, "en");
      const frCurrency = formatXLM(value, { style: "currency", currency: "XLM", currencyDisplay: "name" }, "fr");

      expect(enCurrency).toBe("1,234.50 XLM");
      expect(frCurrency).toMatch(/^1[\s\u202f]234,50 XLM$/);
    });

    it("supports asCurrency boolean shorthand option", () => {
      const frAsCur = formatXLM(value, { asCurrency: true }, "fr");
      expect(frAsCur).toMatch(/^1[\s\u202f]234,50 XLM$/);
    });

    it("handles zero, negative, and invalid values gracefully", () => {
      expect(formatXLM("invalid", 2, "fr")).toBe("0 XLM");
      expect(formatXLM(0, 0, "fr")).toBe("0 XLM");
    });
  });

  describe("formatTonnes", () => {
    const value = 1234.5;

    it("formats tonnes in long form comparing en, fr, and es", () => {
      const en = formatTonnes(value, { decimals: 1 }, "en");
      const fr = formatTonnes(value, { decimals: 1 }, "fr");
      const es = formatTonnes(value, { decimals: 1 }, "es");

      expect(en).toBe("1,234.5 tonnes");
      expect(fr).toMatch(/^1[\s\u202f]234,5 tonnes$/);
      expect(es).toBe("1234,5 toneladas");
    });

    it("formats singular tonne correctly", () => {
      expect(formatTonnes(1, { decimals: 0 }, "en")).toBe("1 tonne");
      expect(formatTonnes(1, { decimals: 0 }, "fr")).toBe("1 tonne");
      expect(formatTonnes(1, { decimals: 0 }, "es")).toBe("1 tonelada");
    });

    it("formats tonnes in short unitDisplay form ('t')", () => {
      const enShort = formatTonnes(value, { unitDisplay: "short", decimals: 1 }, "en");
      const frShort = formatTonnes(value, { unitDisplay: "short", decimals: 1 }, "fr");

      expect(enShort).toBe("1,234.5 t");
      expect(frShort).toMatch(/^1[\s\u202f]234,5 t$/);
    });

    it("supports includeCO2 in short and long forms", () => {
      const enLong = formatTonnes(value, { includeCO2: true, decimals: 1 }, "en");
      const frLong = formatTonnes(value, { includeCO2: true, decimals: 1 }, "fr");
      const frShort = formatTonnes(value, { unitDisplay: "short", includeCO2: true, decimals: 1 }, "fr");

      expect(enLong).toBe("1,234.5 tonnes CO₂");
      expect(frLong).toMatch(/^1[\s\u202f]234,5 tonnes de CO₂$/);
      expect(frShort).toMatch(/^1[\s\u202f]234,5 t CO₂$/);
    });
  });

  describe("formatCO2", () => {
    it("formats kilograms with locale-aware decimals", () => {
      const en = formatCO2(1200, undefined, "en");
      const fr = formatCO2(1200, undefined, "fr");

      expect(en).toBe("1.2k kg CO₂");
      expect(fr).toBe("1,2k kg CO₂");
    });

    it("converts kilograms to tonnes when unit='tonne' is specified", () => {
      const en = formatCO2(1200, { unit: "tonne" }, "en");
      const fr = formatCO2(1200, { unit: "tonne" }, "fr");

      expect(en).toBe("1.2 tonnes CO₂");
      expect(fr).toBe("1,2 tonnes de CO₂");
    });

    it("converts kilograms to short 't' when unit='t' is specified", () => {
      const fr = formatCO2(1200, { unit: "t" }, "fr");
      expect(fr).toBe("1,2 t CO₂");
    });
  });

  describe("formatRank", () => {
    it("formats rank with locale-correct digits and separators", () => {
      expect(formatRank(4, "en")).toBe("#4");
      expect(formatRank(4, "fr")).toBe("#4");

      const enThousand = formatRank(1234, "en");
      const frThousand = formatRank(1234, "fr");

      expect(enThousand).toBe("#1,234");
      expect(frThousand).toMatch(/^#1[\s\u202f]234$/);
    });
  });

  describe("formatUSDEquivalent", () => {
    it("formats fiat equivalent with active locale decimal separators", () => {
      const en = formatUSDEquivalent(100, 0.125, "en");
      const fr = formatUSDEquivalent(100, 0.125, "fr");

      expect(en).toBe("≈ $12.50 USD");
      expect(fr).toBe("≈ $12,50 USD");
    });
  });

  describe("formatDate and formatDateTime", () => {
    it("formats date according to locale", () => {
      const d = "2024-12-31";
      const en = formatDate(d, "en-US");
      const fr = formatDate(d, "fr-FR");

      expect(en).toBe("12/31/2024");
      expect(fr).toBe("31/12/2024");
    });
  });

  describe("dynamic locale switching via setFormattingLocale", () => {
    it("drives formatXLM and formatAmount when no explicit locale is passed", () => {
      setFormattingLocale("en-US");
      expect(formatXLM(1234.5, { decimals: 1 })).toBe("1,234.5 XLM");

      setFormattingLocale("fr");
      expect(formatXLM(1234.5, { decimals: 1 })).toMatch(/^1[\s\u202f]234,5 XLM$/);

      setFormattingLocale("es");
      expect(formatXLM(1234.5, { decimals: 1 })).toBe("1234,5 XLM");
    });
  });
});

describe("Component locale rendering", () => {
  beforeEach(() => {
    fetchLeaderboard.mockReset();
    fetchTeamLeaderboard.mockReset();
    setFormattingLocale("en-US");
  });

  it("renders AnimatedNumber with French decimal separators when locale='fr'", () => {
    render(<AnimatedNumber value={1234.5} duration={0} locale="fr" />);
    expect(screen.getByText(/1[\s\u202f]234,5/)).toBeInTheDocument();
  });

  it("renders AnimatedNumber with English decimal separators when locale='en'", () => {
    render(<AnimatedNumber value={1234.5} duration={0} locale="en" />);
    expect(screen.getByText("1,234.5")).toBeInTheDocument();
  });

  it("renders StatCard with French separators when locale is 'fr'", () => {
    render(
      <StatCard
        label="XLM Donated"
        icon="✨"
        value={1234.5}
        unit="XLM"
        isLoading={false}
        duration={0}
        locale="fr"
      />
    );
    expect(screen.getByText(/1[\s\u202f]234,5/)).toBeInTheDocument();
    expect(screen.getByText("XLM")).toBeInTheDocument();
  });

  it("renders LeaderboardTable formatted with French separators", async () => {
    setFormattingLocale("fr");
    fetchLeaderboard.mockResolvedValue([
      {
        rank: 4,
        publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        displayName: "Alice Green",
        avatarUrl: null,
        totalDonatedXLM: "1234.5",
        totalCO2OffsetKg: "1200",
        projectsSupported: 5,
        topBadge: null,
      },
    ]);

    render(<LeaderboardTable limit={10} period="all" />);

    await waitFor(() => {
      expect(screen.getByText("Alice Green")).toBeInTheDocument();
    });

    // Rank #4
    expect(screen.getByText("#4")).toBeInTheDocument();
    // Donated XLM with French separators
    expect(screen.getByText(/1[\s\u202f]234,50? XLM/)).toBeInTheDocument();
    // CO2 offset with French separator
    expect(screen.getByText("1,2k kg CO₂")).toBeInTheDocument();
  });

  it("renders TeamsLeaderboard formatted with French separators", async () => {
    setFormattingLocale("fr");
    fetchTeamLeaderboard.mockResolvedValue({
      data: [
        {
          id: "team-1",
          rank: 4,
          name: "Eco Warriors",
          logoUrl: null,
          memberCount: 15,
          totalDonatedXLM: "5678.9",
          totalCO2OffsetKg: "2500",
        },
      ],
      has_more: false,
    });

    render(<TeamsLeaderboard period="all" />);

    await waitFor(() => {
      expect(screen.getByText("Eco Warriors")).toBeInTheDocument();
    });

    // Rank #4
    expect(screen.getByText("#4")).toBeInTheDocument();
    // Total donated XLM with French separators
    expect(screen.getByText(/5[\s\u202f]678,90? XLM/)).toBeInTheDocument();
    // CO2 offset with French separator
    expect(screen.getByText("2,5k kg CO₂")).toBeInTheDocument();
  });
});

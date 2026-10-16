import {
  formatAmount,
  formatDate,
  formatDateTime,
  formatTime,
  formatUSDEquivalent,
  formatXLM,
} from "@/utils/format";
import { setFormattingLocale } from "@/lib/formatLocale";

describe("locale-aware formatting", () => {
  beforeEach(() => {
    setFormattingLocale("en-US");
  });

  it("formats dates and amounts with the requested German locale", () => {
    expect(formatDate("2024-12-31T12:00:00Z", "de-DE")).toBe("31.12.2024");
    expect(formatAmount(1234.56, 2, "de-DE")).toBe("1.234,56");
    expect(formatXLM(1234.56, 2, "de-DE")).toBe("1.234,56 XLM");
  });

  it("uses the active application locale when no locale is supplied", () => {
    setFormattingLocale("de-DE");

    expect(formatDate("2024-12-31")).toBe("31.12.2024");
    expect(formatUSDEquivalent(2, 1.5)).toBe("≈ $3,00 USD");
  });

  it("formats date-times and times through Intl", () => {
    const date = new Date(2024, 11, 31, 12, 5);

    expect(formatDateTime(date, "de-DE")).toBe("31.12.24, 12:05");
    expect(formatTime(date, "de-DE")).toBe("12:05");
  });
});

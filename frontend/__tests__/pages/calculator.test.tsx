/**
 * @jest-environment jsdom
 *
 * Frontend tests for pages/calculator.tsx — the carbon footprint calculator
 * at /calculator (issue #1306).
 *
 * The page fetches projects only to resolve an offset rate and the donate
 * target, so `@/lib/api` is mocked and the assertions focus on the three
 * acceptance criteria: lifestyle inputs drive the annual tonnage, the result
 * sentence reports tonnes + the XLM needed to offset them, and the donate
 * button pre-fills that amount through the existing `?amount=` query param.
 *
 * The helpers (`computeFootprintKg`, `computeOffsetXlm`) are unit-tested
 * directly so the UI assertions can reuse them instead of hard-coding the
 * emission-factor arithmetic.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockFetchProjects = jest.fn();
jest.mock("@/lib/api", () => ({
  fetchProjects: (...args: unknown[]) => mockFetchProjects(...args),
}));

import CalculatorPage, {
  computeFootprintKg,
  computeOffsetXlm,
  DEFAULT_GRAMS_CO2_PER_XLM,
  type FootprintInput,
} from "@/pages/calculator";
import type { ClimateProject } from "@/utils/types";

const PROJECT = {
  id: "proj-1",
  name: "Mangrove Revival",
  co2_per_xlm: 8500,
} as unknown as ClimateProject;

const RATE = PROJECT.co2_per_xlm as number;

/** Slider defaults matching the page's initial state. */
const DEFAULTS: FootprintInput = { flights: 2, carKm: 8000, diet: "omnivore", monthlyKwh: 350 };

function expectedSentence(gramsPerXlm: number, input = DEFAULTS): string {
  const tonnes = computeFootprintKg(input) / 1000;
  const xlm = computeOffsetXlm(tonnes, gramsPerXlm);
  return `You need to donate ${xlm.toLocaleString("en-US")} XLM to fully offset it.`;
}

describe("footprint helpers", () => {
  test("diet is the only zero-input contributor", () => {
    expect(computeFootprintKg({ flights: 0, carKm: 0, diet: "vegan", monthlyKwh: 0 })).toBe(1500);
    expect(computeFootprintKg({ flights: 0, carKm: 0, diet: "highMeat", monthlyKwh: 0 })).toBe(3300);
  });

  test("offset rounds up to a whole XLM and guards bad rates", () => {
    expect(computeOffsetXlm(1, 8500)).toBe(118);
    expect(computeOffsetXlm(1, 0)).toBe(0);
    expect(computeOffsetXlm(0, 8500)).toBe(0);
  });
});

describe("CalculatorPage", () => {
  beforeEach(() => {
    mockFetchProjects.mockReset();
  });

  test("reports the estimated footprint in tonnes and the offsetting XLM amount", async () => {
    mockFetchProjects.mockResolvedValue([PROJECT]);
    const { container } = render(<CalculatorPage />);

    await screen.findByRole("link", { name: "Donate to offset my footprint" });

    const tonnes = computeFootprintKg(DEFAULTS) / 1000;
    expect(container.textContent).toContain(`Your footprint is ${tonnes.toFixed(1)} tonnes`);
    expect(container.textContent).toContain(expectedSentence(RATE));
  });

  test("changing a slider changes the estimated footprint", async () => {
    mockFetchProjects.mockResolvedValue([PROJECT]);
    const { container } = render(<CalculatorPage />);
    await screen.findByRole("link", { name: "Donate to offset my footprint" });

    fireEvent.change(screen.getByLabelText("Car kilometres per year"), {
      target: { value: "20000" },
    });

    const tonnes = computeFootprintKg({ ...DEFAULTS, carKm: 20000 }) / 1000;
    expect(container.textContent).toContain(`Your footprint is ${tonnes.toFixed(1)} tonnes`);
    expect(container.textContent).toContain(expectedSentence(RATE, { ...DEFAULTS, carKm: 20000 }));
  });

  test("switching diet type changes the estimate", async () => {
    mockFetchProjects.mockResolvedValue([PROJECT]);
    const { container } = render(<CalculatorPage />);
    await screen.findByRole("link", { name: "Donate to offset my footprint" });

    await userEvent.click(screen.getByLabelText("Vegan"));

    const tonnes = computeFootprintKg({ ...DEFAULTS, diet: "vegan" }) / 1000;
    expect(container.textContent).toContain(`Your footprint is ${tonnes.toFixed(1)} tonnes`);
    expect(container.textContent).toContain(expectedSentence(RATE, { ...DEFAULTS, diet: "vegan" }));
  });

  test("donate button links to the project with the offset amount pre-filled", async () => {
    mockFetchProjects.mockResolvedValue([PROJECT]);
    render(<CalculatorPage />);

    const link = await screen.findByRole("link", { name: "Donate to offset my footprint" });
    const xlm = computeOffsetXlm(computeFootprintKg(DEFAULTS) / 1000, RATE);
    expect(link).toHaveAttribute("href", `/projects/proj-1?amount=${xlm}`);
  });

  test("falls back to the default offset rate when no project publishes one", async () => {
    mockFetchProjects.mockResolvedValue([{ ...PROJECT, co2_per_xlm: 0 }]);
    const { container } = render(<CalculatorPage />);

    const link = await screen.findByRole("link", { name: "Donate to offset my footprint" });
    expect(container.textContent).toContain(
      `default offset rate of ${DEFAULT_GRAMS_CO2_PER_XLM.toLocaleString("en-US")} g CO₂ per XLM`,
    );
    const xlm = computeOffsetXlm(computeFootprintKg(DEFAULTS) / 1000, DEFAULT_GRAMS_CO2_PER_XLM);
    expect(link).toHaveAttribute("href", `/projects/proj-1?amount=${xlm}`);
  });

  test("disables the donate button when projects cannot be loaded", async () => {
    mockFetchProjects.mockRejectedValue(new Error("network down"));
    render(<CalculatorPage />);

    await waitFor(() => expect(mockFetchProjects).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Donate to offset my footprint" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Donate to offset my footprint" })).toBeNull();
  });
});

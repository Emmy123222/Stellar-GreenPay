import React from "react";
import { render, screen } from "@testing-library/react";
import { StatCard } from "@/pages/impact";

describe("Impact StatCard with Fiat Subtitle", () => {
  test("renders label, value, unit, and fiat subtitle", () => {
    render(
      <StatCard
        label="XLM Donated"
        icon="✨"
        value="1250"
        unit="XLM"
        isLoading={false}
        subtitle="≈ $156.25 USD"
      />
    );

    expect(screen.getByText("XLM Donated")).toBeInTheDocument();
    expect(screen.getByText("XLM")).toBeInTheDocument();
    const subtitle = screen.getByTestId("stat-card-subtitle");
    expect(subtitle).toBeInTheDocument();
    expect(subtitle.textContent).toBe("≈ $156.25 USD");
  });

  test("does not render subtitle when loading", () => {
    render(
      <StatCard
        label="XLM Donated"
        icon="✨"
        value="1250"
        unit="XLM"
        isLoading={true}
        subtitle="≈ $156.25 USD"
      />
    );

    expect(screen.queryByTestId("stat-card-subtitle")).not.toBeInTheDocument();
  });
});

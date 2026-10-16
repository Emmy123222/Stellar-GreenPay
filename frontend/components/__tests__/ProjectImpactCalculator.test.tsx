import { render, screen, fireEvent } from "@testing-library/react";
import ProjectImpactCalculator from "../ProjectImpactCalculator";

describe("ProjectImpactCalculator", () => {
  it("renders presets and calls onAmountChange when clicked", () => {
    const onAmountChange = jest.fn();
    render(
      <ProjectImpactCalculator
        calcAmount="50"
        onAmountChange={onAmountChange}
        co2OffsetKg={10}
      />
    );

    expect(screen.getByText("Impact Calculator")).toBeInTheDocument();
    expect(screen.getByText("50 XLM")).toBeInTheDocument();

    const btn100 = screen.getByText("100 XLM");
    fireEvent.click(btn100);
    expect(onAmountChange).toHaveBeenCalledWith("100");
  });

  it("calculates offset and displays tree analogy", () => {
    render(
      <ProjectImpactCalculator
        calcAmount="10"
        onAmountChange={jest.fn()}
        co2OffsetKg={100}
      />
    );

    // 10 * 100 = 1000 kg CO2 = 1.0k kg CO2
    expect(screen.getByText(/1\.0k kg CO₂ offset/i)).toBeInTheDocument();
    // 1000 / 22 = ~45.5 trees/year -> between 10 and 50 -> "A growing mini-forest! 🌲"
    expect(screen.getByText(/~45\.5 trees\/year/i)).toBeInTheDocument();
    expect(screen.getByText("A growing mini-forest! 🌲")).toBeInTheDocument();
  });
});

import { render, screen, act } from "@testing-library/react";
import AnimatedNumber, { normalizeXLMAmount } from "../AnimatedNumber";
import { StatCard } from "@/pages/impact";

describe("AnimatedNumber & XLM normalization", () => {
  describe("normalizeXLMAmount helper", () => {
    it("normalizes small float 0.000001 using toFixed(7)", () => {
      expect(normalizeXLMAmount(0.000001)).toBe("0.0000010");
    });

    it("normalizes scientific notation 1e-6 using toFixed(7)", () => {
      expect(normalizeXLMAmount(1e-6)).toBe("0.0000010");
    });

    it("normalizes string float '0.000001' using toFixed(7)", () => {
      expect(normalizeXLMAmount("0.000001")).toBe("0.0000010");
    });

    it("normalizes scientific notation string '1e-6' using toFixed(7)", () => {
      expect(normalizeXLMAmount("1e-6")).toBe("0.0000010");
    });

    it("normalizes 1 stroop (0.0000001) using toFixed(7)", () => {
      expect(normalizeXLMAmount(0.0000001)).toBe("0.0000001");
      expect(normalizeXLMAmount(1e-7)).toBe("0.0000001");
    });

    it("handles zero and invalid inputs safely", () => {
      expect(normalizeXLMAmount(0)).toBe("0.0000000");
      expect(normalizeXLMAmount("invalid")).toBe("0.0000000");
    });
  });

  describe("AnimatedNumber component", () => {
    it("input 0.000001 → displays 0.0000010 XLM", () => {
      render(<AnimatedNumber value={0.000001} unit="XLM" duration={0} />);
      expect(screen.getByText("0.0000010 XLM")).toBeInTheDocument();
    });

    it("input 1e-6 → same result (displays 0.0000010 XLM)", () => {
      render(<AnimatedNumber value={1e-6} unit="XLM" duration={0} />);
      expect(screen.getByText("0.0000010 XLM")).toBeInTheDocument();
    });

    it("input normalized with toFixed(7) beforehand displays 0.0000010 XLM", () => {
      const normalizedFloat = normalizeXLMAmount(0.000001);
      const normalizedScientific = normalizeXLMAmount(1e-6);

      const { unmount } = render(
        <AnimatedNumber value={normalizedFloat} unit="XLM" duration={0} />
      );
      expect(screen.getByText("0.0000010 XLM")).toBeInTheDocument();
      unmount();

      render(<AnimatedNumber value={normalizedScientific} unit="XLM" duration={0} />);
      expect(screen.getByText("0.0000010 XLM")).toBeInTheDocument();
    });

    it("handles string representations '0.000001' and '1e-6'", () => {
      const { unmount } = render(
        <AnimatedNumber value="0.000001" unit="XLM" duration={0} />
      );
      expect(screen.getByText("0.0000010 XLM")).toBeInTheDocument();
      unmount();

      render(<AnimatedNumber value="1e-6" unit="XLM" duration={0} />);
      expect(screen.getByText("0.0000010 XLM")).toBeInTheDocument();
    });

    it("completes animation with default duration to 0.0000010 XLM", () => {
      jest.useFakeTimers();
      render(<AnimatedNumber value={1e-6} unit="XLM" duration={1500} />);

      act(() => {
        jest.advanceTimersByTime(1600);
      });

      expect(screen.getByText("0.0000010 XLM")).toBeInTheDocument();
      jest.useRealTimers();
    });

    it("displays integer values correctly when unit is not XLM", () => {
      render(<AnimatedNumber value={104} duration={0} />);
      expect(screen.getByText("104")).toBeInTheDocument();
    });

    it("supports custom formatter", () => {
      render(
        <AnimatedNumber
          value={1234}
          duration={0}
          formatter={(val) => `$${val.toFixed(2)}`}
        />
      );
      expect(screen.getByText("$1234.00")).toBeInTheDocument();
    });
  });

  describe("StatCard component in Impact dashboard", () => {
    it("input 0.000001 → displays 0.0000010 XLM", () => {
      render(
        <StatCard
          label="XLM Donated"
          icon="✨"
          value={0.000001}
          unit="XLM"
          isLoading={false}
          duration={0}
        />
      );
      expect(screen.getByText("0.0000010")).toBeInTheDocument();
      expect(screen.getByText("XLM")).toBeInTheDocument();
    });

    it("input 1e-6 → same result (displays 0.0000010 XLM)", () => {
      render(
        <StatCard
          label="XLM Donated"
          icon="✨"
          value={1e-6}
          unit="XLM"
          isLoading={false}
          duration={0}
        />
      );
      expect(screen.getByText("0.0000010")).toBeInTheDocument();
      expect(screen.getByText("XLM")).toBeInTheDocument();
    });
  });
});

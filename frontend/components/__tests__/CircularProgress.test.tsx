import React from "react";
import { render, screen, act } from "@testing-library/react";
import CircularProgress from "../CircularProgress";

describe("CircularProgress Component", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("Accessibility and ARIA attributes", () => {
    it("renders with role='progressbar' and standard ARIA attributes", () => {
      render(<CircularProgress percentage={45} />);
      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toBeInTheDocument();
      expect(progressbar).toHaveAttribute("aria-valuenow", "45");
      expect(progressbar).toHaveAttribute("aria-valuemin", "0");
      expect(progressbar).toHaveAttribute("aria-valuemax", "100");
      expect(progressbar).toHaveAttribute("aria-label", "Progress");
    });

    it("accepts a custom aria-label", () => {
      render(<CircularProgress percentage={75} aria-label="Campaign Goal Progress" />);
      const progressbar = screen.getByRole("progressbar", { name: /campaign goal progress/i });
      expect(progressbar).toBeInTheDocument();
      expect(progressbar).toHaveAttribute("aria-valuenow", "75");
    });
  });

  describe("Progress math and stroke-dash proportions", () => {
    const size = 48;
    const strokeWidth = 4;
    const radius = (size - strokeWidth) / 2; // 22
    const circumference = radius * 2 * Math.PI;

    it("renders correct stroke-dash proportions for 0%", () => {
      render(<CircularProgress percentage={0} size={size} strokeWidth={strokeWidth} />);
      
      const arc = screen.getByTestId("circular-progress-bar");
      expect(arc).toHaveAttribute("stroke-dasharray", circumference.toString());

      act(() => {
        jest.advanceTimersByTime(100);
      });

      // 0% progress means offset = circumference (empty progress)
      expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(circumference, 2);
      expect(screen.getByText("0%")).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    });

    it("renders correct stroke-dash proportions for 50%", () => {
      render(<CircularProgress percentage={50} size={size} strokeWidth={strokeWidth} />);
      
      const arc = screen.getByTestId("circular-progress-bar");
      expect(arc).toHaveAttribute("stroke-dasharray", circumference.toString());

      act(() => {
        jest.advanceTimersByTime(100);
      });

      // 50% progress means offset = circumference * 0.5
      const expectedOffset = ((100 - 50) / 100) * circumference;
      expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(expectedOffset, 2);
      expect(screen.getByText("50%")).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    });

    it("renders correct stroke-dash proportions for 100%", () => {
      render(<CircularProgress percentage={100} size={size} strokeWidth={strokeWidth} />);
      
      const arc = screen.getByTestId("circular-progress-bar");
      expect(arc).toHaveAttribute("stroke-dasharray", circumference.toString());

      act(() => {
        jest.advanceTimersByTime(100);
      });

      // 100% progress means offset = 0 (full circle)
      expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 2);
      expect(screen.getByText("100%")).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    });
  });

  describe("Out-of-range value clamping", () => {
    const size = 48;
    const strokeWidth = 4;
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;

    it("clamps negative percentage to 0%", () => {
      render(<CircularProgress percentage={-25} size={size} strokeWidth={strokeWidth} />);
      
      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toHaveAttribute("aria-valuenow", "0");
      expect(screen.getByText("0%")).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(100);
      });

      const arc = screen.getByTestId("circular-progress-bar");
      expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(circumference, 2);
    });

    it("clamps percentage above 100% to 100%", () => {
      render(<CircularProgress percentage={150} size={size} strokeWidth={strokeWidth} />);
      
      const progressbar = screen.getByRole("progressbar");
      expect(progressbar).toHaveAttribute("aria-valuenow", "100");
      expect(screen.getByText("100%")).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(100);
      });

      const arc = screen.getByTestId("circular-progress-bar");
      expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 2);
    });
  });

  describe("Color styling based on thresholds", () => {
    it("uses green color for percentage under 50%", () => {
      render(<CircularProgress percentage={30} />);
      const arc = screen.getByTestId("circular-progress-bar");
      expect(arc.getAttribute("class")).toContain("text-green-500");
    });

    it("uses teal color for percentage between 50% and 80%", () => {
      render(<CircularProgress percentage={65} />);
      const arc = screen.getByTestId("circular-progress-bar");
      expect(arc.getAttribute("class")).toContain("text-teal-500");
    });

    it("uses emerald color for percentage above 80%", () => {
      render(<CircularProgress percentage={95} />);
      const arc = screen.getByTestId("circular-progress-bar");
      expect(arc.getAttribute("class")).toContain("text-emerald-500");
    });
  });
});

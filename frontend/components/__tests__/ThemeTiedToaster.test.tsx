import { render, screen, act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { ThemeTiedToaster } from "../ThemeTiedToaster";

describe("ThemeTiedToaster Accessibility", () => {
  beforeEach(async () => {
    // Clear any existing toasts from sonner
    act(() => {
      toast.dismiss();
    });
    await new Promise((r) => setTimeout(r, 10));
  });

  it("renders persistent polite and assertive live regions for screen readers", () => {
    render(<ThemeTiedToaster />);

    const statusRegion = screen.getByRole("status");
    expect(statusRegion).toBeInTheDocument();
    expect(statusRegion).toHaveAttribute("aria-live", "polite");
    expect(statusRegion).toHaveAttribute("aria-atomic", "true");

    const alertRegion = screen.getByRole("alert");
    expect(alertRegion).toBeInTheDocument();
    expect(alertRegion).toHaveAttribute("aria-live", "assertive");
    expect(alertRegion).toHaveAttribute("aria-atomic", "true");
  });

  it("places success / status notifications into the polite live region", async () => {
    render(<ThemeTiedToaster />);

    act(() => {
      toast.success("Donation of 100 XLM completed successfully!");
    });

    const statusRegion = screen.getByRole("status");
    await waitFor(() => {
      expect(statusRegion).toHaveTextContent(
        "Donation of 100 XLM completed successfully!",
      );
    });

    const alertRegion = screen.getByRole("alert");
    expect(alertRegion).not.toHaveTextContent(
      "Donation of 100 XLM completed successfully!",
    );
  });

  it("places error notifications into the assertive live region", async () => {
    render(<ThemeTiedToaster />);

    act(() => {
      toast.error("Donation transaction failed: Horizon timeout");
    });

    const alertRegion = screen.getByRole("alert");
    await waitFor(() => {
      expect(alertRegion).toHaveTextContent(
        "Donation transaction failed: Horizon timeout",
      );
    });

    const statusRegion = screen.getByRole("status");
    expect(statusRegion).not.toHaveTextContent(
      "Donation transaction failed: Horizon timeout",
    );
  });

  it("mirrors title and description into the appropriate live region", async () => {
    render(<ThemeTiedToaster />);

    act(() => {
      toast.success("Impact project funded", {
        description: "Your receipt has been generated on-chain.",
      });
    });

    const statusRegion = screen.getByRole("status");
    await waitFor(() => {
      expect(statusRegion).toHaveTextContent("Impact project funded");
      expect(statusRegion).toHaveTextContent("Your receipt has been generated on-chain.");
    });
  });
});


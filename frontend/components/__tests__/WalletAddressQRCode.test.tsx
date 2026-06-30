/**
 * WalletAddressQRCode.test.tsx
 *
 * Unit tests for the WalletAddressQRCode component (issue #405).
 *
 * Covers:
 *  1. buildSep0007Uri – URI format, memo truncation.
 *  2. Toggle button renders and collapses/expands the QR panel.
 *  3. When expanded, the wallet address is visible and the canvas is present.
 *  4. aria-expanded tracks open/closed state.
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import WalletAddressQRCode, { buildSep0007Uri } from "../WalletAddressQRCode";

// qrcode.react renders a <canvas> which jsdom cannot fully support; mock it
// so the DOM tree exists without triggering canvas-not-implemented errors.
jest.mock("qrcode.react", () => ({
  QRCodeCanvas: ({ value }: { value: string }) => (
    <canvas data-testid="qr-canvas" data-value={value} />
  ),
}));

const WALLET = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const PROJECT_NAME = "Amazon Reforestation";

// ── buildSep0007Uri ───────────────────────────────────────────────────────────

describe("buildSep0007Uri", () => {
  it("starts with the web+stellar:pay? scheme", () => {
    const uri = buildSep0007Uri(WALLET, PROJECT_NAME);
    expect(uri).toMatch(/^web\+stellar:pay\?/);
  });

  it("includes the destination param equal to the wallet address", () => {
    const uri = buildSep0007Uri(WALLET, PROJECT_NAME);
    const params = new URLSearchParams(uri.split("?")[1]);
    expect(params.get("destination")).toBe(WALLET);
  });

  it("includes a memo_type of MEMO_TEXT", () => {
    const uri = buildSep0007Uri(WALLET, PROJECT_NAME);
    const params = new URLSearchParams(uri.split("?")[1]);
    expect(params.get("memo_type")).toBe("MEMO_TEXT");
  });

  it("includes a memo that starts with 'GreenPay:'", () => {
    const uri = buildSep0007Uri(WALLET, PROJECT_NAME);
    const params = new URLSearchParams(uri.split("?")[1]);
    expect(params.get("memo")).toMatch(/^GreenPay:/);
  });

  it("truncates the memo to 28 characters (Stellar text-memo limit)", () => {
    const longName = "A Very Long Project Name That Exceeds The Limit";
    const uri = buildSep0007Uri(WALLET, longName);
    const params = new URLSearchParams(uri.split("?")[1]);
    expect(params.get("memo")!.length).toBeLessThanOrEqual(28);
  });
});

// ── WalletAddressQRCode component ────────────────────────────────────────────

describe("WalletAddressQRCode", () => {
  it("renders the toggle button collapsed by default", () => {
    render(
      <WalletAddressQRCode walletAddress={WALLET} projectName={PROJECT_NAME} />
    );
    const btn = screen.getByRole("button", { name: /scan to donate/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("does not show the QR canvas or wallet address before expanding", () => {
    render(
      <WalletAddressQRCode walletAddress={WALLET} projectName={PROJECT_NAME} />
    );
    expect(screen.queryByTestId("qr-canvas")).not.toBeInTheDocument();
    expect(screen.queryByText(WALLET)).not.toBeInTheDocument();
  });

  it("expands the panel and shows the QR canvas when the button is clicked", () => {
    render(
      <WalletAddressQRCode walletAddress={WALLET} projectName={PROJECT_NAME} />
    );
    fireEvent.click(screen.getByRole("button", { name: /scan to donate/i }));

    expect(screen.getByTestId("qr-canvas")).toBeInTheDocument();
  });

  it("shows the wallet address text when expanded", () => {
    render(
      <WalletAddressQRCode walletAddress={WALLET} projectName={PROJECT_NAME} />
    );
    fireEvent.click(screen.getByRole("button", { name: /scan to donate/i }));

    expect(screen.getByText(WALLET)).toBeInTheDocument();
  });

  it("sets aria-expanded=true after expanding", () => {
    render(
      <WalletAddressQRCode walletAddress={WALLET} projectName={PROJECT_NAME} />
    );
    const btn = screen.getByRole("button", { name: /scan to donate/i });
    fireEvent.click(btn);

    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses the panel again when the button is clicked a second time", () => {
    render(
      <WalletAddressQRCode walletAddress={WALLET} projectName={PROJECT_NAME} />
    );
    const btn = screen.getByRole("button");
    fireEvent.click(btn); // expand
    fireEvent.click(btn); // collapse

    expect(screen.queryByTestId("qr-canvas")).not.toBeInTheDocument();
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("passes a valid SEP-0007 URI as the QR value", () => {
    render(
      <WalletAddressQRCode walletAddress={WALLET} projectName={PROJECT_NAME} />
    );
    fireEvent.click(screen.getByRole("button", { name: /scan to donate/i }));

    const canvas = screen.getByTestId("qr-canvas");
    const qrValue = canvas.getAttribute("data-value") ?? "";
    expect(qrValue).toMatch(/^web\+stellar:pay\?/);
    expect(qrValue).toContain(WALLET);
  });

  it("renders an accessible region with a descriptive aria-label when expanded", () => {
    render(
      <WalletAddressQRCode walletAddress={WALLET} projectName={PROJECT_NAME} />
    );
    fireEvent.click(screen.getByRole("button", { name: /scan to donate/i }));

    const region = screen.getByRole("region", {
      name: new RegExp(`donate to ${PROJECT_NAME}`, "i"),
    });
    expect(region).toBeInTheDocument();
  });
});

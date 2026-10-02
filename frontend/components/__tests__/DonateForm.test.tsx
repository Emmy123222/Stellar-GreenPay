import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import DonateForm from "../DonateForm";
import type { ClimateProject } from "@/utils/types";
import {
  buildDonationTransaction,
  buildContractDonationTransaction,
  submitTransaction,
  getXLMBalance,
  getAssetBalance,
  getDonorStats,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { recordDonation } from "@/lib/api";

jest.mock("@/lib/stellar", () => ({
  buildDonationTransaction: jest.fn(),
  buildContractDonationTransaction: jest.fn(),
  submitTransaction: jest.fn(),
  explorerUrl: jest.fn((hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`),
  getXLMBalance: jest.fn(),
  getAssetBalance: jest.fn(),
  getDonorStats: jest.fn(),
  hashMessage: jest.fn(() => 12345),
  CONTRACT_ID: "",
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  recordDonation: jest.fn(),
}));

const mockProject: ClimateProject = {
  id: "test-proj-1",
  name: "Amazon Reforestation",
  category: "Reforestation",
  description: "Planting trees across the Amazon rainforest.",
  goalXLM: "10000",
  raisedXLM: "2500",
  donorCount: 42,
  walletAddress: "GPROJECTWALLET1234567890123456789012345678901234567890123",
  verified: true,
  status: "active",
  location: "Brazil",
  co2OffsetKg: 5000,
  co2_per_xlm: 2000,
  tags: ["trees", "rainforest"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const mockPublicKey = "GDONORWALLET12345678901234567890123456789012345678901234";

describe("DonateForm Loading & Signing State", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getXLMBalance as jest.Mock).mockResolvedValue("500.00");
    (getAssetBalance as jest.Mock).mockResolvedValue("100.00");
    (getDonorStats as jest.Mock).mockResolvedValue(null);
    (buildDonationTransaction as jest.Mock).mockResolvedValue({
      toXDR: () => "mock-tx-xdr",
    });
    (recordDonation as jest.Mock).mockResolvedValue({ success: true });
  });

  test("shows initial idle state with Donate button enabled after amount entered", async () => {
    render(<DonateForm project={mockProject} publicKey={mockPublicKey} />);

    const donateButton = screen.getByRole("button", { name: /Donate/i });
    expect(donateButton).toBeDisabled();

    // Select preset amount
    const presetBtn = screen.getByRole("button", { name: "25 XLM" });
    fireEvent.click(presetBtn);

    expect(donateButton).toBeEnabled();
    expect(donateButton).toHaveTextContent(/Donate 25 XLM/i);
  });

  test("shows spinner and 'Signing with Freighter…' message after clicking Donate, and disables button", async () => {
    let resolveSign: (val: any) => void;
    const signPromise = new Promise((resolve) => {
      resolveSign = resolve;
    });
    (signTransactionWithWallet as jest.Mock).mockReturnValue(signPromise);

    render(<DonateForm project={mockProject} publicKey={mockPublicKey} initialAmount="50" />);

    const donateButton = screen.getByRole("button", { name: /Donate/i });
    expect(donateButton).toBeEnabled();

    // Click Donate
    fireEvent.click(donateButton);

    // 1. Shows spinner and "Signing with Freighter…" message
    await waitFor(() => {
      expect(screen.getAllByText(/Signing with Freighter…/i).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByRole("status", { name: /Loading/i })).toBeInTheDocument();

    // 2. Donate button is disabled during signing to prevent double-submission
    expect(donateButton).toBeDisabled();

    // 3. Inputs are disabled during processing
    const input = screen.getByPlaceholderText(/Or enter custom amount.../i);
    expect(input).toBeDisabled();

    // Resolve signing to finish
    await act(async () => {
      resolveSign!({ signedXDR: "signed-xdr", error: null });
    });
  });

  test("transitions to 'Submitting to Stellar network…' after signing", async () => {
    let resolveSign: (val: any) => void;
    const signPromise = new Promise((resolve) => {
      resolveSign = resolve;
    });
    (signTransactionWithWallet as jest.Mock).mockReturnValue(signPromise);

    let resolveSubmit: (val: any) => void;
    const submitPromise = new Promise((resolve) => {
      resolveSubmit = resolve;
    });
    (submitTransaction as jest.Mock).mockReturnValue(submitPromise);

    render(<DonateForm project={mockProject} publicKey={mockPublicKey} initialAmount="10" />);

    const donateButton = screen.getByRole("button", { name: /Donate/i });
    fireEvent.click(donateButton);

    // First shows signing state
    await waitFor(() => {
      expect(screen.getAllByText(/Signing with Freighter…/i).length).toBeGreaterThanOrEqual(1);
    });

    // Simulate Freighter signing finishing
    await act(async () => {
      resolveSign!({ signedXDR: "signed-xdr-sample", error: null });
    });

    // Transitions to "Submitting to Stellar network…" with spinner
    await waitFor(() => {
      expect(screen.getAllByText(/Submitting to Stellar network…/i).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByRole("status", { name: /Loading/i })).toBeInTheDocument();
    expect(donateButton).toBeDisabled();

    // Finish submission
    await act(async () => {
      resolveSubmit!({ hash: "mock-tx-hash-789" });
    });
  });

  test("shows 'Transaction confirmed!' success state with a link to Stellar Expert", async () => {
    (signTransactionWithWallet as jest.Mock).mockResolvedValue({
      signedXDR: "signed-xdr-done",
      error: null,
    });
    (submitTransaction as jest.Mock).mockResolvedValue({
      hash: "stellar-tx-hash-12345",
    });

    const onSuccessMock = jest.fn();

    render(
      <DonateForm
        project={mockProject}
        publicKey={mockPublicKey}
        initialAmount="25"
        onSuccess={onSuccessMock}
      />
    );

    const donateButton = screen.getByRole("button", { name: /Donate/i });
    fireEvent.click(donateButton);

    // Wait for success screen
    await waitFor(() => {
      expect(screen.getByText("Transaction confirmed!")).toBeInTheDocument();
    });

    // Link to Stellar Expert is shown with correct href
    const expertLink = screen.getByRole("link", { name: /View on Stellar Expert ↗/i });
    expect(expertLink).toBeInTheDocument();
    expect(expertLink).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/stellar-tx-hash-12345"
    );

    expect(onSuccessMock).toHaveBeenCalledTimes(1);
  });

  test("handles signing rejection gracefully and allows retry", async () => {
    jest.useFakeTimers();
    (signTransactionWithWallet as jest.Mock).mockResolvedValue({
      signedXDR: null,
      error: "Transaction rejected.",
    });

    render(<DonateForm project={mockProject} publicKey={mockPublicKey} initialAmount="15" />);

    const donateButton = screen.getByRole("button", { name: /Donate/i });
    fireEvent.click(donateButton);

    await waitFor(() => {
      expect(screen.getByText("Transaction rejected.")).toBeInTheDocument();
    });

    // Fast-forward error timeout
    act(() => {
      jest.advanceTimersByTime(3100);
    });

    await waitFor(() => {
      expect(donateButton).toHaveTextContent(/Donate 15 XLM/i);
      expect(donateButton).toBeEnabled();
    });

    jest.useRealTimers();
  });
});

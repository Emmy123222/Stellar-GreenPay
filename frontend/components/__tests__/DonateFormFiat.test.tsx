import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DonateForm from "../DonateForm";
import { PriceProvider } from "@/lib/priceContext";
import type { ClimateProject } from "@/utils/types";
import {
  buildDonationTransaction,
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
  id: "test-proj-fiat",
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

describe("DonateForm Fiat Currency Equivalents", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    (getXLMBalance as jest.Mock).mockResolvedValue("500.00");
    (getAssetBalance as jest.Mock).mockResolvedValue("100.00");
    (getDonorStats as jest.Mock).mockResolvedValue(null);
    (buildDonationTransaction as jest.Mock).mockResolvedValue({
      toXDR: () => "mock-tx-xdr",
    });
    (recordDonation as jest.Mock).mockResolvedValue({ success: true });
  });

  test("renders approximate fiat equivalent when an amount is entered", () => {
    render(
      <PriceProvider>
        <DonateForm project={mockProject} publicKey={mockPublicKey} initialAmount="100" />
      </PriceProvider>
    );

    const fiatElement = screen.getByTestId("fiat-equivalent");
    expect(fiatElement).toBeInTheDocument();
    expect(fiatElement.textContent).toMatch(/≈ \$\d+(\.\d+)? USD/);
  });

  test("allows switching fiat currency and updates the equivalent preview", () => {
    render(
      <PriceProvider>
        <DonateForm project={mockProject} publicKey={mockPublicKey} initialAmount="100" />
      </PriceProvider>
    );

    const select = screen.getByLabelText("Select fiat currency");
    expect(select).toBeInTheDocument();

    // Switch to EUR
    fireEvent.change(select, { target: { value: "EUR" } });
    expect(screen.getByTestId("fiat-equivalent").textContent).toMatch(/≈ €\d+(\.\d+)? EUR/);

    // Switch to BRL
    fireEvent.change(select, { target: { value: "BRL" } });
    expect(screen.getByTestId("fiat-equivalent").textContent).toMatch(/≈ R\$ \d+(\.\d+)? BRL/);
  });

  test("renders approximate fiat equivalent in transaction confirmation receipt", async () => {
    (signTransactionWithWallet as jest.Mock).mockResolvedValue({
      signedXDR: "signed-xdr-sample",
      error: null,
    });
    (submitTransaction as jest.Mock).mockResolvedValue({
      hash: "stellar-tx-hash-12345",
    });

    render(
      <PriceProvider>
        <DonateForm project={mockProject} publicKey={mockPublicKey} initialAmount="50" />
      </PriceProvider>
    );

    const donateButton = screen.getByRole("button", { name: /Donate/i });
    fireEvent.click(donateButton);

    await waitFor(() => {
      expect(screen.getByText("Transaction confirmed!")).toBeInTheDocument();
    });

    const receiptFiat = screen.getByTestId("receipt-fiat-equivalent");
    expect(receiptFiat).toBeInTheDocument();
    expect(receiptFiat.textContent).toMatch(/≈ \$\d+(\.\d+)? USD/);
  });
});

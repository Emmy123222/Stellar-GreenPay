import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DonateForm from "../DonateForm";
import type { ClimateProject } from "@/utils/types";
import {
  buildDonationTransaction,
  buildPathPaymentDonationTransaction,
  getStrictSendQuote,
  submitTransaction,
  getXLMBalance,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import { recordDonation } from "@/lib/api";

jest.mock("@/lib/stellar", () => ({
  buildDonationTransaction: jest.fn(),
  buildContractDonationTransaction: jest.fn(),
  buildPathPaymentDonationTransaction: jest.fn(),
  getStrictSendQuote: jest.fn(),
  submitTransaction: jest.fn(),
  explorerUrl: jest.fn((hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`),
  getXLMBalance: jest.fn(),
  getAssetBalance: jest.fn(),
  getDonorStats: jest.fn(),
  hashMessage: jest.fn(() => 1),
  CONTRACT_ID: "",
}));
jest.mock("@/lib/wallet", () => ({ signTransactionWithWallet: jest.fn() }));
jest.mock("@/lib/api", () => ({ recordDonation: jest.fn() }));

const ISSUER = `G${"I".repeat(55)}`;
const DONOR = `G${"D".repeat(55)}`;

const baseProject: ClimateProject = {
  id: "proj-1",
  name: "Mangroves",
  description: "",
  category: "Reforestation" as ClimateProject["category"],
  location: "Kenya",
  walletAddress: `G${"P".repeat(55)}`,
  goalXLM: "1000",
  raisedXLM: "0",
  donorCount: 0,
  co2OffsetKg: 0,
  status: "active" as ClimateProject["status"],
  verified: true,
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as ClimateProject;

const usdcProject = { ...baseProject, preferredAsset: { code: "USDC", issuer: ISSUER } };

function quote(destAmount = "9.8765432", destMin = "9.7777777") {
  return {
    sendAsset: { code: "XLM" },
    sendAmount: "100.0000000",
    destAsset: { code: "USDC", issuer: ISSUER },
    destAmount,
    destMin,
    slippageBps: 100,
    path: [],
    quotedAt: Date.now(),
  };
}

const mockQuote = getStrictSendQuote as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  (getXLMBalance as jest.Mock).mockResolvedValue("1000");
  (buildPathPaymentDonationTransaction as jest.Mock).mockResolvedValue({ toXDR: () => "XDR" });
  (signTransactionWithWallet as jest.Mock).mockResolvedValue({ signedXDR: "SIGNED" });
  (submitTransaction as jest.Mock).mockResolvedValue({ hash: "a".repeat(64) });
  (recordDonation as jest.Mock).mockResolvedValue({ amount: "9.8765432", currency: "USDC" });
});

function enterAmount(value: string) {
  fireEvent.change(screen.getByLabelText("Donation amount in XLM"), { target: { value } });
}

describe("DonateForm — DEX conversion to the project's preferred asset", () => {
  it("shows no conversion UI for XLM projects", () => {
    render(<DonateForm project={baseProject} publicKey={DONOR} />);
    enterAmount("100");
    expect(screen.queryByTestId("conversion-preview")).not.toBeInTheDocument();
    expect(mockQuote).not.toHaveBeenCalled();
  });

  it("quotes the conversion and previews amount, minimum and rate before signing", async () => {
    mockQuote.mockResolvedValue(quote());
    render(<DonateForm project={usdcProject} publicKey={DONOR} />);
    enterAmount("100");

    const preview = await screen.findByTestId("conversion-preview");
    await waitFor(() => expect(preview).toHaveTextContent("≈ 9.8765432 USDC"));
    expect(preview).toHaveTextContent("Minimum received9.7777777 USDC");
    expect(mockQuote).toHaveBeenLastCalledWith({
      sendAsset: { code: "XLM" },
      sendAmount: "100.0000000",
      destAsset: { code: "USDC", issuer: ISSUER },
      slippageBps: 100,
    });
    expect(signTransactionWithWallet).not.toHaveBeenCalled();
  });

  it("re-quotes when the donor changes the slippage limit", async () => {
    mockQuote.mockResolvedValue(quote());
    render(<DonateForm project={usdcProject} publicKey={DONOR} />);
    enterAmount("100");
    await screen.findByText("≈ 9.8765432 USDC");

    fireEvent.click(screen.getByRole("button", { name: "2%" }));
    await waitFor(() => expect(mockQuote).toHaveBeenLastCalledWith(expect.objectContaining({ slippageBps: 200 })));
    expect(screen.getByRole("button", { name: "2%" })).toHaveAttribute("aria-pressed", "true");
  });

  it("disables donating when the DEX has no route", async () => {
    mockQuote.mockResolvedValue(null);
    render(<DonateForm project={usdcProject} publicKey={DONOR} />);
    enterAmount("100");

    expect(await screen.findByRole("alert")).toHaveTextContent(/No DEX route from XLM to USDC/);
    expect(screen.getByRole("button", { name: /Donate/ })).toBeDisabled();
  });

  it("signs a path payment with the approved destMin and records it as a path payment", async () => {
    mockQuote.mockResolvedValue(quote());
    render(<DonateForm project={usdcProject} publicKey={DONOR} />);
    enterAmount("100");
    await screen.findByText("≈ 9.8765432 USDC");

    // Market moved slightly but is still above the approved minimum.
    mockQuote.mockResolvedValueOnce(quote("9.8000000", "9.7020000"));
    fireEvent.click(screen.getByRole("button", { name: /Donate/ }));

    await screen.findByText("Transaction confirmed!");
    expect(buildPathPaymentDonationTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        toPublicKey: usdcProject.walletAddress,
        quote: expect.objectContaining({ destMin: "9.7777777", destAmount: "9.8000000" }),
      }),
    );
    expect(buildDonationTransaction).not.toHaveBeenCalled();
    expect(recordDonation).toHaveBeenCalledWith(expect.objectContaining({ pathPayment: true, transactionHash: "a".repeat(64) }));
    expect(screen.getByText("9.8765432 USDC")).toBeInTheDocument();
  });

  it("refuses to sign when the fresh quote falls below the approved minimum", async () => {
    mockQuote.mockResolvedValue(quote());
    render(<DonateForm project={usdcProject} publicKey={DONOR} />);
    enterAmount("100");
    await screen.findByText("≈ 9.8765432 USDC");

    mockQuote.mockResolvedValueOnce(quote("9.7000000", "9.6030000"));
    fireEvent.click(screen.getByRole("button", { name: /Donate/ }));

    expect(await screen.findByText(/moved beyond your slippage limit/)).toBeInTheDocument();
    expect(signTransactionWithWallet).not.toHaveBeenCalled();
    expect(buildPathPaymentDonationTransaction).not.toHaveBeenCalled();
  });
});

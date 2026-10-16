import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DonateForm from "../DonateForm";
import type { ClimateProject } from "@/utils/types";

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

jest.mock("@/lib/wallet", () => ({ signTransactionWithWallet: jest.fn() }));
jest.mock("@/lib/api", () => ({ recordDonation: jest.fn() }));

const mockProject = {
  id: "draft-proj",
  name: "Amazon Reforestation",
  category: "Reforestation",
  description: "Planting trees.",
  goalXLM: "10000",
  raisedXLM: "2500",
  donorCount: 42,
  walletAddress: "GPROJECTWALLET1234567890123456789012345678901234567890123",
  verified: true,
  co2_per_xlm: 1.5,
} as unknown as ClimateProject;

const DRAFT_KEY = "greenpay:donate-draft:draft-proj";

describe("DonateForm draft persistence", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("persists the amount and message, and restores them on remount", async () => {
    const { unmount } = render(<DonateForm project={mockProject} publicKey="GDONOR" />);

    fireEvent.change(screen.getByPlaceholderText(/or enter custom amount/i), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByPlaceholderText(/leave a message of support/i), {
      target: { value: "keep going" },
    });

    await waitFor(() => {
      const raw = window.sessionStorage.getItem(DRAFT_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw as string)).toMatchObject({ amount: "42", message: "keep going" });
    });

    unmount();
    render(<DonateForm project={mockProject} publicKey="GDONOR" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("42")).toBeInTheDocument();
      expect(screen.getByDisplayValue("keep going")).toBeInTheDocument();
    });
  });

  it("clears the stored draft when Cancel is clicked", async () => {
    render(<DonateForm project={mockProject} publicKey="GDONOR" />);

    fireEvent.change(screen.getByPlaceholderText(/or enter custom amount/i), {
      target: { value: "10" },
    });
    await waitFor(() => expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull());
  });
});

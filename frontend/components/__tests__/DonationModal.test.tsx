import React, { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DonationModal from "../DonationModal";
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

describe("DonationModal", () => {
  const onCloseMock = jest.fn();
  const onSuccessMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    (getXLMBalance as jest.Mock).mockResolvedValue("500.00");
    (getAssetBalance as jest.Mock).mockResolvedValue("100.00");
    (getDonorStats as jest.Mock).mockResolvedValue(null);
    (buildDonationTransaction as jest.Mock).mockResolvedValue({
      toXDR: () => "mock-tx-xdr",
    });
    (recordDonation as jest.Mock).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  describe("ARIA attributes and Dialog structure", () => {
    it("renders with role='dialog', aria-modal='true', and aria-labelledby matching title", () => {
      render(
        <DonationModal
          project={mockProject}
          publicKey={mockPublicKey}
          isOpen={true}
          onClose={onCloseMock}
          onSuccess={onSuccessMock}
        />
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "donation-modal-title");
      expect(dialog).toHaveAttribute("tabindex", "-1");

      const title = screen.getByText(`Donate to ${mockProject.name}`);
      expect(title).toBeInTheDocument();
      expect(title).toHaveAttribute("id", "donation-modal-title");
      expect(dialog).toHaveAccessibleName(`Donate to ${mockProject.name}`);
    });

    it("does not render when isOpen is false", () => {
      render(
        <DonationModal
          project={mockProject}
          publicKey={mockPublicKey}
          isOpen={false}
          onClose={onCloseMock}
          onSuccess={onSuccessMock}
        />
      );

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  describe("Background content inert and aria-hidden management", () => {
    it("makes outside siblings aria-hidden and inert when open, and restores on close", async () => {
      const user = userEvent.setup();

      function FlowComponent() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <div data-testid="page-header">
              <h1>Stellar GreenPay</h1>
              <button data-testid="open-modal-btn" onClick={() => setIsOpen(true)}>
                Open Modal
              </button>
            </div>
            <main data-testid="page-main">
              <p>Main content of the page</p>
            </main>
            <DonationModal
              project={mockProject}
              publicKey={mockPublicKey}
              isOpen={isOpen}
              onClose={() => setIsOpen(false)}
            />
          </div>
        );
      }

      render(<FlowComponent />);

      const header = screen.getByTestId("page-header");
      const main = screen.getByTestId("page-main");
      const openBtn = screen.getByTestId("open-modal-btn");

      // Before open: neither is aria-hidden nor inert
      expect(header).not.toHaveAttribute("aria-hidden");
      expect(header).not.toHaveAttribute("inert");
      expect(main).not.toHaveAttribute("aria-hidden");
      expect(main).not.toHaveAttribute("inert");

      // Click to open modal
      await user.click(openBtn);

      // Dialog is open
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // Outside content is now aria-hidden and inert
      expect(header).toHaveAttribute("aria-hidden", "true");
      expect(header).toHaveAttribute("inert");
      expect(main).toHaveAttribute("aria-hidden", "true");
      expect(main).toHaveAttribute("inert");

      // Close modal by pressing Escape
      await user.keyboard("{Escape}");

      // Outside content is restored
      expect(header).not.toHaveAttribute("aria-hidden");
      expect(header).not.toHaveAttribute("inert");
      expect(main).not.toHaveAttribute("aria-hidden");
      expect(main).not.toHaveAttribute("inert");
    });
  });

  describe("Focus management (open, trap, restore)", () => {
    it("moves focus to the dialog upon open and returns focus to the trigger on close", async () => {
      const user = userEvent.setup();

      function FlowComponent() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button data-testid="trigger-btn" onClick={() => setIsOpen(true)}>
              Make a Donation
            </button>
            <DonationModal
              project={mockProject}
              publicKey={mockPublicKey}
              isOpen={isOpen}
              onClose={() => setIsOpen(false)}
            />
          </div>
        );
      }

      render(<FlowComponent />);

      const triggerBtn = screen.getByTestId("trigger-btn");
      triggerBtn.focus();
      expect(triggerBtn).toHaveFocus();

      // Open modal
      await user.click(triggerBtn);

      // Focus moved to the dialog
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveFocus();

      // Close modal using close button
      const closeBtn = screen.getByRole("button", { name: "Close donation widget" });
      await user.click(closeBtn);

      // Focus returned to trigger
      expect(triggerBtn).toHaveFocus();
    });

    it("closes the dialog on Escape and restores focus to trigger", async () => {
      const user = userEvent.setup();

      function FlowComponent() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button data-testid="trigger-btn" onClick={() => setIsOpen(true)}>
              Open
            </button>
            <DonationModal
              project={mockProject}
              publicKey={mockPublicKey}
              isOpen={isOpen}
              onClose={() => setIsOpen(false)}
            />
          </div>
        );
      }

      render(<FlowComponent />);

      const triggerBtn = screen.getByTestId("trigger-btn");
      await user.click(triggerBtn);

      expect(screen.getByRole("dialog")).toHaveFocus();

      // Press Escape
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(triggerBtn).toHaveFocus();
    });

    it("traps focus inside the dialog with Tab and Shift+Tab cycling", async () => {
      const user = userEvent.setup();

      render(
        <DonationModal
          project={mockProject}
          publicKey={mockPublicKey}
          isOpen={true}
          onClose={onCloseMock}
          onSuccess={onSuccessMock}
        />
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveFocus();

      const closeBtn = screen.getByRole("button", { name: "Close donation widget" });

      // Tab from dialog moves to first focusable element (close button)
      await user.tab();
      expect(closeBtn).toHaveFocus();

      // Shift+Tab from close button (first element) wraps to last focusable element
      await user.tab({ shift: true });

      // Note: when amount is empty, donate button is disabled, so message input is last focusable element
      const messageInput = screen.getByPlaceholderText(/Leave a message of support.../i);
      expect(messageInput).toHaveFocus();

      // Tab from last element wraps back to first element (close button)
      await user.tab();
      expect(closeBtn).toHaveFocus();
    });

    it("traps focus when form has custom amount and cancel button is visible", async () => {
      const user = userEvent.setup();

      render(
        <DonationModal
          project={mockProject}
          publicKey={mockPublicKey}
          isOpen={true}
          onClose={onCloseMock}
          onSuccess={onSuccessMock}
        />
      );

      const closeBtn = screen.getByRole("button", { name: "Close donation widget" });
      const amountPreset = screen.getByRole("button", { name: "25 XLM" });

      // Click preset amount so Donate button is enabled and Cancel button is rendered
      await user.click(amountPreset);

      const cancelBtn = screen.getByRole("button", { name: "Cancel" });
      expect(cancelBtn).toBeInTheDocument();

      // Focus close button
      closeBtn.focus();
      expect(closeBtn).toHaveFocus();

      // Shift+Tab wraps to Cancel button (the last enabled focusable element)
      await user.tab({ shift: true });
      expect(cancelBtn).toHaveFocus();

      // Tab from Cancel button wraps back to close button
      await user.tab();
      expect(closeBtn).toHaveFocus();
    });

    it("Shift+Tab from dialog container wraps to last focusable element", async () => {
      const user = userEvent.setup();

      render(
        <DonationModal
          project={mockProject}
          publicKey={mockPublicKey}
          isOpen={true}
          onClose={onCloseMock}
          onSuccess={onSuccessMock}
        />
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveFocus();

      // Shift+Tab from dialog container focuses the last focusable element
      await user.tab({ shift: true });

      const messageInput = screen.getByPlaceholderText(/Leave a message of support.../i);
      expect(messageInput).toHaveFocus();
    });
  });

  describe("Backdrop click and scroll behavior", () => {
    it("closes when clicking directly on the backdrop", () => {
      render(
        <DonationModal
          project={mockProject}
          publicKey={mockPublicKey}
          isOpen={true}
          onClose={onCloseMock}
          onSuccess={onSuccessMock}
        />
      );

      const dialog = screen.getByRole("dialog");
      const backdrop = dialog.parentElement as HTMLElement;

      fireEvent.click(backdrop);
      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it("does not close when clicking inside the dialog", () => {
      render(
        <DonationModal
          project={mockProject}
          publicKey={mockPublicKey}
          isOpen={true}
          onClose={onCloseMock}
          onSuccess={onSuccessMock}
        />
      );

      const dialog = screen.getByRole("dialog");
      fireEvent.click(dialog);
      expect(onCloseMock).not.toHaveBeenCalled();
    });

    it("locks body scroll when open and restores it when closed", () => {
      const { rerender } = render(
        <DonationModal
          project={mockProject}
          publicKey={mockPublicKey}
          isOpen={true}
          onClose={onCloseMock}
          onSuccess={onSuccessMock}
        />
      );

      expect(document.body.style.overflow).toBe("hidden");

      rerender(
        <DonationModal
          project={mockProject}
          publicKey={mockPublicKey}
          isOpen={false}
          onClose={onCloseMock}
          onSuccess={onSuccessMock}
        />
      );

      expect(document.body.style.overflow).toBe("");
    });
  });
});

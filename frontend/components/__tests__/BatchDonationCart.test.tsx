import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import BatchDonationCart from "../BatchDonationCart";
import {
  buildBatchDonationTransaction,
  submitTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import type { ClimateProject } from "@/utils/types";

jest.mock("@/lib/stellar", () => ({
  buildBatchDonationTransaction: jest.fn(),
  submitTransaction: jest.fn(),
}));

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: jest.fn(),
}));

const projects: ClimateProject[] = [
  {
    id: "forest-project",
    name: "Forest Restoration",
    category: "Reforestation",
    description: "Restore native forests.",
    goalXLM: "1000",
    raisedXLM: "100",
    donorCount: 10,
    walletAddress: "GFORESTWALLET1234567890123456789012345678901234567890123",
    verified: true,
    status: "active",
    location: "Brazil",
    co2OffsetKg: 2000,
    co2_per_xlm: 2,
    tags: ["forest"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "solar-project",
    name: "Solar for Schools",
    category: "Solar Energy",
    description: "Install solar panels at schools.",
    goalXLM: "2000",
    raisedXLM: "200",
    donorCount: 20,
    walletAddress: "GSOLARWALLET12345678901234567890123456789012345678901234",
    verified: true,
    status: "active",
    location: "Kenya",
    co2OffsetKg: 3000,
    co2_per_xlm: 3,
    tags: ["solar"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const publicKey = "GDONORWALLET12345678901234567890123456789012345678901234";
const mockBuildBatchDonation = jest.mocked(buildBatchDonationTransaction);
const mockSubmitTransaction = jest.mocked(submitTransaction);
const mockSignTransaction = jest.mocked(signTransactionWithWallet);

function openCart() {
  render(<BatchDonationCart publicKey={publicKey} projects={projects} />);
  fireEvent.click(screen.getByRole("button", { name: /open donation cart/i }));
}

function addProject(projectName: string, amount?: string) {
  fireEvent.change(screen.getByRole("combobox", { name: /project to add/i }), {
    target: { value: projects.find(({ name }) => name === projectName)?.id },
  });
  if (amount !== undefined) {
    fireEvent.change(screen.getByRole("spinbutton", { name: /amount to add/i }), {
      target: { value: amount },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: /add project/i }));
}

describe("BatchDonationCart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildBatchDonation.mockResolvedValue({
      toXDR: () => "unsigned-batch-xdr",
    } as Awaited<ReturnType<typeof buildBatchDonationTransaction>>);
    mockSignTransaction.mockResolvedValue({
      signedXDR: "signed-batch-xdr",
      error: null,
    });
    mockSubmitTransaction.mockResolvedValue({ hash: "batch-hash" } as Awaited<
      ReturnType<typeof submitTransaction>
    >);
  });

  it("shows an empty-cart hint before any projects are added", () => {
    openCart();

    expect(screen.getByText("Your cart is empty")).toBeInTheDocument();
    expect(screen.getByText("Add projects to donate to multiple at once")).toBeInTheDocument();
  });

  it("adds and removes projects while updating the total", () => {
    openCart();
    addProject("Forest Restoration", "25");
    addProject("Solar for Schools", "5");

    expect(screen.getByRole("button", { name: /remove forest restoration/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove solar for schools/i })).toBeInTheDocument();
    expect(screen.getByText("30 XLM")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove forest restoration/i }));

    expect(screen.queryByRole("button", { name: /remove forest restoration/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove solar for schools/i })).toBeInTheDocument();
    expect(screen.getByText("5 XLM")).toBeInTheDocument();
  });

  it("updates the existing entry instead of adding a duplicate project", () => {
    openCart();
    addProject("Forest Restoration", "10");
    addProject("Forest Restoration", "20");

    expect(screen.getByRole("heading", { name: "Donation Cart (1/10)" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /donation amount for forest restoration/i }))
      .toHaveValue(20);
    expect(screen.getByText("20 XLM")).toBeInTheDocument();
  });

  it("recomputes the total when an item's amount is edited", () => {
    openCart();
    addProject("Forest Restoration", "10");
    addProject("Solar for Schools", "5");

    fireEvent.change(
      screen.getByRole("spinbutton", { name: /donation amount for forest restoration/i }),
      { target: { value: "35" } },
    );

    expect(screen.getByText("40 XLM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /donate all \(40 xlm\)/i })).toBeInTheDocument();
  });

  it("builds, signs, and submits one payment per cart item at checkout", async () => {
    const onDonate = jest.fn();
    render(
      <BatchDonationCart
        publicKey={publicKey}
        projects={projects}
        onDonate={onDonate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /open donation cart/i }));
    addProject("Forest Restoration", "12");
    addProject("Solar for Schools", "8");
    fireEvent.click(screen.getByRole("button", { name: /donate all \(20 xlm\)/i }));

    await waitFor(() => {
      expect(mockBuildBatchDonation).toHaveBeenCalledWith({
        fromPublicKey: publicKey,
        payments: [
          { toPublicKey: projects[0].walletAddress, amount: "12" },
          { toPublicKey: projects[1].walletAddress, amount: "8" },
        ],
      });
    });
    expect(mockBuildBatchDonation.mock.calls[0][0].payments).toHaveLength(2);
    expect(mockSignTransaction).toHaveBeenCalledWith("unsigned-batch-xdr");
    expect(mockSubmitTransaction).toHaveBeenCalledWith("signed-batch-xdr");
    await waitFor(() => {
      expect(onDonate).toHaveBeenCalledWith([
        { project: projects[0], amount: "12" },
        { project: projects[1], amount: "8" },
      ]);
    });
    expect(screen.getByRole("button", { name: /open donation cart/i })).toBeInTheDocument();
  });

  it("keeps the cart and reports a wallet failure so checkout can be retried", async () => {
    mockSignTransaction.mockResolvedValue({
      signedXDR: null,
      error: "Wallet signing was rejected.",
    });
    openCart();
    addProject("Forest Restoration", "12");
    fireEvent.click(screen.getByRole("button", { name: /donate all/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Wallet signing was rejected.");
    expect(screen.getByRole("button", { name: /remove forest restoration/i })).toBeInTheDocument();
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });
});

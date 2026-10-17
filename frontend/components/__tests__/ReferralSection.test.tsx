import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReferralSection from "../ReferralSection";
import { fetchReferralStats } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  fetchReferralStats: jest.fn(),
  createReferral: jest.fn(),
}));

const mockedFetchReferralStats = jest.mocked(fetchReferralStats);

describe("ReferralSection", () => {
  const publicKey = "GUSERREFERRALCODE123";
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetchReferralStats.mockResolvedValue({
      referralCount: 2,
      referralBonusXLM: "10",
      referredBy: null,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("shows the referral URL containing the user's code from the loaded referral stats", async () => {
    render(<ReferralSection publicKey={publicKey} />);

    const link = await screen.findByRole("textbox", { name: /your referral link/i });
    expect(mockedFetchReferralStats).toHaveBeenCalledWith(publicKey);
    expect(link).toHaveValue(`${window.location.origin}/?ref=${publicKey}`);
  });

  it("copies the referral URL and displays the copied state", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<ReferralSection publicKey={publicKey} />);

    const copyButton = await screen.findByRole("button", { name: "Copy" });
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?ref=${publicKey}`);
    });
    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("does not show copied when the clipboard API is unavailable", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    render(<ReferralSection publicKey={publicKey} />);

    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copied!" })).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith("Failed to copy:", expect.any(TypeError));
    consoleError.mockRestore();
  });
});

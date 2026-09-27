import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DonationQRCode, { DonationQRCodeHandle } from "../DonationQRCode";

// Mock qrcode.react
jest.mock("qrcode.react", () => ({
  QRCodeCanvas: ({ value }: { value: string }) => (
    <canvas data-testid="qr-canvas" data-value={value} />
  ),
}));

describe("DonationQRCode", () => {
  const mockStellarUri = "web+stellar:pay?destination=GBVNQON4MFVGJXK5WT7VQJJZXFVHZJB6BHFWJCW7OF5BLNGOLZJQHIY&amount=50";
  const mockProjectName = "Mangrove Restoration";
  const mockProjectId = "mangrove-101";

  beforeEach(() => {
    jest.clearAllMocks();
    HTMLCanvasElement.prototype.toDataURL = jest.fn(() => "data:image/png;base64,mockpngdata");
  });

  it("renders the QR canvas with accessible label", () => {
    render(
      <DonationQRCode
        stellarUri={mockStellarUri}
        projectName={mockProjectName}
        projectId={mockProjectId}
      />
    );

    expect(screen.getByLabelText(`QR code to donate to ${mockProjectName}`)).toBeInTheDocument();
    expect(screen.getByTestId("qr-canvas")).toBeInTheDocument();
  });

  it("renders Download PNG and Copy Link buttons by default", () => {
    render(
      <DonationQRCode
        stellarUri={mockStellarUri}
        projectName={mockProjectName}
        projectId={mockProjectId}
      />
    );

    expect(screen.getByRole("button", { name: /download png/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
  });

  it("triggers download with greenpay-donate-[projectId].png when Download PNG is clicked", () => {
    const clickMock = jest.fn();
    const originalCreateElement = document.createElement.bind(document);

    jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === "a") {
        el.click = clickMock;
      }
      return el;
    });

    render(
      <DonationQRCode
        stellarUri={mockStellarUri}
        projectName={mockProjectName}
        projectId={mockProjectId}
      />
    );

    const downloadBtn = screen.getByRole("button", { name: /download png/i });
    fireEvent.click(downloadBtn);

    expect(clickMock).toHaveBeenCalled();
    (document.createElement as any).mockRestore();
  });

  it("copies donation URL to clipboard when Copy Link is clicked", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(
      <DonationQRCode
        stellarUri={mockStellarUri}
        projectName={mockProjectName}
        projectId={mockProjectId}
        donationUrl="https://stellar-greenpay.org/donate/mangrove-101"
      />
    );

    const copyBtn = screen.getByRole("button", { name: /copy link/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith("https://stellar-greenpay.org/donate/mangrove-101");
    await waitFor(() => {
      expect(screen.getByText(/copied!/i)).toBeInTheDocument();
    });
  });

  it("supports imperative handle via ref", () => {
    const clickMock = jest.fn();
    const originalCreateElement = document.createElement.bind(document);

    jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === "a") {
        el.click = clickMock;
      }
      return el;
    });

    const ref = React.createRef<DonationQRCodeHandle>();
    render(
      <DonationQRCode
        ref={ref}
        stellarUri={mockStellarUri}
        projectName={mockProjectName}
        projectId={mockProjectId}
      />
    );

    expect(ref.current).toBeDefined();
    ref.current?.downloadPNG();

    expect(clickMock).toHaveBeenCalled();
    (document.createElement as any).mockRestore();
  });
});

/**
 * @jest-environment jsdom
 *
 * Frontend tests for pages/bridge.tsx — the USDC → Stellar bridge at /bridge.
 *
 * These tests deliberately use the *real* I18nProvider and the real en.json
 * locale rather than stubbing `t`, because the regression this page is
 * guarded against is exactly a page whose copy is missing from the locale
 * files (which would silently fall back to rendering the raw key).
 *
 * The bridge itself is a deep link into Circle's interface, so the wallet
 * interactions we can assert on are: the read-only EVM balance check, the
 * Freighter address lookup, the pre-filled Circle URL, and the donation
 * record posted afterwards.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import type { ClimateProject } from "@/utils/types";

const mockGetAddress = jest.fn();
jest.mock("@stellar/freighter-api", () => ({
  getAddress: (...args: unknown[]) => mockGetAddress(...args),
}));

const mockFetchProjects = jest.fn();
const mockRecordDonation = jest.fn();
jest.mock("@/lib/api", () => ({
  fetchProjects: (...args: unknown[]) => mockFetchProjects(...args),
  recordDonation: (...args: unknown[]) => mockRecordDonation(...args),
}));

import BridgePage from "@/pages/bridge";

const STELLAR_ADDRESS =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const PROJECT = {
  id: "proj-1",
  name: "Mangrove Revival",
  category: "Reforestation",
} as unknown as ClimateProject;

// 250 USDC, expressed the way an ERC-20 contract returns it (6 decimals).
const USDC_BALANCE_HEX = `0x${BigInt(250 * 1e6).toString(16)}`;

const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const POLYGON_USDC = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

function renderPage() {
  return render(
    <I18nProvider>
      <BridgePage />
    </I18nProvider>,
  );
}

/** Install a fake injected EVM provider whose `request` is driven by `impl`. */
function installEthereum(impl: (args: { method: string; params?: unknown[] }) => unknown) {
  const request = jest.fn(async (args: { method: string; params?: unknown[] }) => impl(args));
  (window as unknown as { ethereum: unknown }).ethereum = { request };
  return request;
}

function removeEthereum() {
  delete (window as unknown as { ethereum?: unknown }).ethereum;
}

describe("BridgePage", () => {
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockGetAddress.mockRejectedValue(new Error("no wallet"));
    mockFetchProjects.mockResolvedValue([PROJECT]);
    mockRecordDonation.mockResolvedValue({ id: "don-1" });
    openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
    removeEthereum();
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  describe("documentation", () => {
    test("explains what the bridge does for GreenPay", () => {
      renderPage();

      expect(
        screen.getByRole("heading", { name: "What this bridge does for GreenPay" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/burned on the source chain and an equal amount is minted/i),
      ).toBeInTheDocument();
    });

    test("states what GreenPay does and does not do, so it is not mistaken for a fiat on-ramp", () => {
      renderPage();

      expect(screen.getByText("What GreenPay does")).toBeInTheDocument();
      expect(screen.getByText("What GreenPay does not do")).toBeInTheDocument();
      expect(screen.getByText(/Hold or custody your funds at any point/)).toBeInTheDocument();
      expect(screen.getByText(/it is not a cash on-ramp or off-ramp/)).toBeInTheDocument();
    });

    test("renders the four numbered steps and a link to the written documentation", () => {
      renderPage();

      expect(screen.getByRole("heading", { name: "How to Bridge" })).toBeInTheDocument();
      expect(screen.getByText("Connect your Ethereum wallet")).toBeInTheDocument();
      expect(screen.getByText("Connect your Stellar wallet")).toBeInTheDocument();
      expect(screen.getByText("Open Circle's bridge")).toBeInTheDocument();
      expect(screen.getByText("Complete the transfer on Circle")).toBeInTheDocument();

      const docsLink = screen.getByRole("link", {
        name: "Read the full bridge documentation",
      });
      expect(docsLink).toHaveAttribute("href", expect.stringContaining("docs/bridge.md"));
    });
  });

  describe("bridge button gating", () => {
    test("stays disabled with a hint until a Stellar wallet is connected", async () => {
      renderPage();

      const button = screen.getByRole("button", { name: "Open Circle Bridge" });
      expect(button).toBeDisabled();
      expect(screen.getByText("Connect your Stellar wallet first")).toBeInTheDocument();

      mockGetAddress.mockResolvedValueOnce(STELLAR_ADDRESS);
      await userEvent.click(screen.getByRole("button", { name: "Connect Freighter" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Open Circle Bridge" })).toBeEnabled();
      });
      expect(screen.queryByText("Connect your Stellar wallet first")).not.toBeInTheDocument();
    });
  });

  describe("opening Circle's bridge", () => {
    test("opens Circle with the Stellar destination and selected network pre-filled", async () => {
      mockGetAddress.mockResolvedValue(STELLAR_ADDRESS);
      renderPage();

      const user = userEvent.setup();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Open Circle Bridge" })).toBeEnabled();
      });

      await user.selectOptions(
        screen.getByLabelText("Source (Ethereum)"),
        "polygon",
      );
      await user.click(screen.getByRole("button", { name: "Open Circle Bridge" }));

      expect(openSpy).toHaveBeenCalledTimes(1);
      const url = new URL(openSpy.mock.calls[0][0] as string);
      expect(url.origin).toBe("https://bridge.circle.com");
      expect(url.searchParams.get("destination")).toBe(STELLAR_ADDRESS);
      expect(url.searchParams.get("sourceChain")).toBe("polygon");
      expect(url.searchParams.get("destinationChain")).toBe("stellar");
      expect(url.searchParams.get("token")).toBe("USDC");
    });

    test("records an initiated entry in local history", async () => {
      mockGetAddress.mockResolvedValue(STELLAR_ADDRESS);
      renderPage();

      const user = userEvent.setup();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Open Circle Bridge" })).toBeEnabled();
      });
      await user.click(screen.getByRole("button", { name: "Open Circle Bridge" }));

      await waitFor(() => {
        expect(screen.getByText("Bridge History")).toBeInTheDocument();
      });
      expect(screen.getByText("ethereum → Stellar")).toBeInTheDocument();
      expect(screen.getByText("initiated")).toBeInTheDocument();

      const stored = JSON.parse(
        window.localStorage.getItem("bridge_history") as string,
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        sourceChain: "ethereum",
        destinationChain: "stellar",
        status: "initiated",
      });
    });
  });

  describe("read-only EVM balance check", () => {
    test("tells the user when no injected wallet is available", async () => {
      renderPage();
      await userEvent.click(screen.getByRole("button", { name: "Connect MetaMask" }));

      expect(
        screen.getByText(/MetaMask was not detected/),
      ).toBeInTheDocument();
    });

    test("reads USDC with balanceOf and never requests an approval", async () => {
      const request = installEthereum(({ method }) => {
        if (method === "eth_requestAccounts") return ["0xabc"];
        if (method === "eth_call") return USDC_BALANCE_HEX;
        throw new Error(`unexpected method ${method}`);
      });

      renderPage();
      await userEvent.click(screen.getByRole("button", { name: "Connect MetaMask" }));

      expect(await screen.findByText("$250.00 USDC")).toBeInTheDocument();

      const methods = request.mock.calls.map((call) => (call[0] as { method: string }).method);
      expect(methods).toEqual(["eth_requestAccounts", "eth_call"]);
      expect(methods).not.toContain("eth_sendTransaction");

      const call = request.mock.calls[1][0] as unknown as {
        params: [{ to: string; data: string }, string];
      };
      expect(call.params[0].to).toBe(ETHEREUM_USDC);
      expect(call.params[0].data).toBe(
        `0x70a08231${"abc".padStart(64, "0")}`,
      );
      expect(call.params[1]).toBe("latest");
    });

    test("queries the Polygon USDC contract when Polygon is selected", async () => {
      mockGetAddress.mockResolvedValue(STELLAR_ADDRESS);
      const request = installEthereum(({ method }) => {
        if (method === "eth_requestAccounts") return ["0xabc"];
        if (method === "eth_call") return USDC_BALANCE_HEX;
        throw new Error(`unexpected method ${method}`);
      });

      renderPage();
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Source (Ethereum)"), "polygon");
      await user.click(screen.getByRole("button", { name: "Connect MetaMask" }));

      expect(await screen.findByText("$250.00 USDC")).toBeInTheDocument();
      const call = request.mock.calls[1][0] as unknown as { params: [{ to: string }] };
      expect(call.params[0].to).toBe(POLYGON_USDC);
    });

    test("surfaces a connection failure instead of throwing", async () => {
      installEthereum(() => {
        throw new Error("user rejected");
      });

      renderPage();
      await userEvent.click(screen.getByRole("button", { name: "Connect MetaMask" }));

      expect(
        await screen.findByText("Could not connect to MetaMask."),
      ).toBeInTheDocument();
    });
  });

  describe("recording the donation", () => {
    test("is hidden until a Stellar wallet is connected", () => {
      renderPage();
      expect(screen.queryByRole("heading", { name: "Record as Project Donation" })).not.toBeInTheDocument();
    });

    test("posts a USDC donation for the chosen project and amount", async () => {
      mockGetAddress.mockResolvedValue(STELLAR_ADDRESS);
      renderPage();

      const user = userEvent.setup();
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: "Record as Project Donation" }),
        ).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText("Select Project"), "proj-1");
      await user.type(screen.getByLabelText("Amount (USDC)"), "42.5");
      await user.click(screen.getByRole("button", { name: "Record Donation" }));

      await waitFor(() => {
        expect(mockRecordDonation).toHaveBeenCalledTimes(1);
      });
      expect(mockRecordDonation).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-1",
          donorAddress: STELLAR_ADDRESS,
          amount: "42.50",
          currency: "USDC",
        }),
      );
      expect(await screen.findByText("Donation recorded")).toBeInTheDocument();
    });

    test("keeps the entered values and shows the error when the API rejects", async () => {
      mockGetAddress.mockResolvedValue(STELLAR_ADDRESS);
      mockRecordDonation.mockRejectedValueOnce(new Error("backend exploded"));

      renderPage();
      const user = userEvent.setup();
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: "Record as Project Donation" }),
        ).toBeInTheDocument();
      });

      await user.selectOptions(screen.getByLabelText("Select Project"), "proj-1");
      await user.type(screen.getByLabelText("Amount (USDC)"), "42.5");
      await user.click(screen.getByRole("button", { name: "Record Donation" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("backend exploded");
      // The form must not be cleared on failure so the donor can retry.
      expect(screen.getByLabelText("Amount (USDC)")).toHaveValue(42.5);
    });
  });

  describe("bridge history", () => {
    test("renders persisted entries with translated status labels", async () => {
      window.localStorage.setItem(
        "bridge_history",
        JSON.stringify([
          {
            id: 1,
            sourceChain: "ethereum",
            destinationChain: "stellar",
            stellarAddress: STELLAR_ADDRESS,
            amount: "12.00",
            timestamp: "2026-01-02T03:04:05.000Z",
            status: "completed",
          },
        ]),
      );

      renderPage();

      const history = await screen.findByRole("heading", { name: "Bridge History" });
      const section = history.closest("div") as HTMLElement;
      expect(within(section).getByText("ethereum → Stellar")).toBeInTheDocument();
      expect(within(section).getByText("$12.00 USDC")).toBeInTheDocument();
      expect(within(section).getByText("completed")).toBeInTheDocument();
    });

    test("survives malformed localStorage instead of crashing the page", () => {
      window.localStorage.setItem("bridge_history", "{not json");

      renderPage();

      expect(
        screen.getByRole("heading", { name: "What this bridge does for GreenPay" }),
      ).toBeInTheDocument();
    });
  });
});

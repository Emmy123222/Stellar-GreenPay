/**
 * @jest-environment jsdom
 *
 * Frontend tests for pages/submit-project.tsx — issue #1082.
 *
 * Coverage:
 *  1. "Submit Project" button is disabled when wallet is null (not connected).
 *  2. "Submit Project" button is enabled when a public key is present.
 *  3. The tooltip text "Connect your Freighter wallet to submit a project"
 *     appears in the DOM when the wallet is not connected.
 *  4. Attempting to submit with no wallet shows a toast.error and does NOT
 *     call the submitProject API.
 *  5. Normal submission with a connected wallet still calls submitProject
 *     (no regression).
 *  6. Generic 401 / server errors are still surfaced via the serverError
 *     message (existing behaviour is not regressed).
 *
 * Strategy: we mock `getConnectedPublicKey` to return either null or a
 * public key, then navigate the multi-step wizard to the final
 * "methodology" step where the Submit button lives.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn(), query: {}, pathname: "/submit-project" }),
}));

jest.mock("@/utils/format", () => ({
  PROJECT_CATEGORIES: ["Reforestation", "Solar Energy"],
}));

// Spy on sonner's toast so we can assert toast.error calls.
const mockToastError = jest.fn();
jest.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: jest.fn(),
  },
}));

// Mock the wallet lib — default to disconnected (null).
const mockGetConnectedPublicKey = jest.fn<Promise<string | null>, []>();
jest.mock("@/lib/wallet", () => ({
  getConnectedPublicKey: () => mockGetConnectedPublicKey(),
  connectWallet: jest.fn(),
}));

// Mock the API calls.
const mockSubmitProject = jest.fn();
const mockNotifyAdmin = jest.fn();
jest.mock("@/lib/api", () => ({
  submitProject: (...args: unknown[]) => mockSubmitProject(...args),
  notifyAdmin: (...args: unknown[]) => mockNotifyAdmin(...args),
}));

import SubmitProjectPage from "@/pages/submit-project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate the wizard from "org" through "project" → "wallet" → to the
 * "methodology" step where the Submit button appears.
 * Each step is filled with minimal valid data so validation passes.
 */
async function navigateToMethodologyStep() {
  // Step 1 — org
  fireEvent.change(screen.getByLabelText(/organization name/i), {
    target: { value: "Acme Climate Foundation" },
  });
  fireEvent.change(screen.getByLabelText(/contact email/i), {
    target: { value: "hello@acme.org" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

  // Step 2 — project
  await waitFor(() => screen.getByLabelText(/project name/i));
  fireEvent.change(screen.getByLabelText(/project name/i), {
    target: { value: "Acme Solar Farm" },
  });
  fireEvent.change(screen.getByLabelText(/description/i), {
    target: { value: "Solar farm in Nairobi." },
  });
  fireEvent.change(screen.getByLabelText(/location/i), {
    target: { value: "Nairobi, Kenya" },
  });
  fireEvent.change(screen.getByLabelText(/funding goal/i), {
    target: { value: "50000" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

  // Step 3 — wallet
  await waitFor(() => screen.getByLabelText(/stellar wallet address/i));
  fireEvent.change(screen.getByLabelText(/stellar wallet address/i), {
    target: { value: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

  // Step 4 — methodology
  await waitFor(() => screen.getByLabelText(/methodology name/i));
  fireEvent.change(screen.getByLabelText(/methodology name/i), {
    target: { value: "Verra VM0007" },
  });
  fireEvent.change(screen.getByLabelText(/annual co/i), {
    target: { value: "1200" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SubmitProjectPage — wallet guard (#1082)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotifyAdmin.mockResolvedValue(undefined);
  });

  describe("wallet NOT connected (publicKey === null)", () => {
    beforeEach(() => {
      // getConnectedPublicKey resolves to null → no wallet connected.
      mockGetConnectedPublicKey.mockResolvedValue(null);
    });

    test('Submit button is disabled when wallet is null', async () => {
      render(<SubmitProjectPage />);
      await navigateToMethodologyStep();

      const submitBtn = screen.getByRole("button", { name: /submit project/i });
      expect(submitBtn).toBeDisabled();
    });

    test('tooltip text is visible when wallet is null', async () => {
      render(<SubmitProjectPage />);
      await navigateToMethodologyStep();

      expect(
        screen.getByRole("tooltip"),
      ).toHaveTextContent("Connect your Freighter wallet to submit a project");
    });

    test('clicking Submit shows toast.error and does NOT call submitProject API', async () => {
      render(<SubmitProjectPage />);
      await navigateToMethodologyStep();

      // The button is disabled, but we also want to verify the guard in
      // handleSubmit if triggered by any other means (e.g. keyboard).
      // Fire the click directly to test the handler path.
      const submitBtn = screen.getByRole("button", { name: /submit project/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith(
          "Connect your Freighter wallet to submit a project",
        );
      });

      expect(mockSubmitProject).not.toHaveBeenCalled();
    });
  });

  describe("wallet connected (publicKey present)", () => {
    beforeEach(() => {
      mockGetConnectedPublicKey.mockResolvedValue(
        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      );
    });

    test('Submit button is enabled when wallet is connected', async () => {
      render(<SubmitProjectPage />);
      await navigateToMethodologyStep();

      const submitBtn = screen.getByRole("button", { name: /submit project/i });
      expect(submitBtn).not.toBeDisabled();
    });

    test('no wallet tooltip shown when wallet is connected', async () => {
      render(<SubmitProjectPage />);
      await navigateToMethodologyStep();

      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    test('normal submission calls submitProject and navigates to done step', async () => {
      mockSubmitProject.mockResolvedValueOnce({ reviewTimeline: "5–10 business days" });

      render(<SubmitProjectPage />);
      await navigateToMethodologyStep();

      fireEvent.click(screen.getByRole("button", { name: /submit project/i }));

      await waitFor(() => {
        expect(mockSubmitProject).toHaveBeenCalledTimes(1);
      });

      // "done" step heading appears.
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /project submitted/i })).toBeTruthy();
      });
    });

    test('generic server error is still shown inline (no regression)', async () => {
      mockSubmitProject.mockRejectedValueOnce({
        response: { data: { message: "Submission failed. Please try again." } },
      });

      render(<SubmitProjectPage />);
      await navigateToMethodologyStep();

      fireEvent.click(screen.getByRole("button", { name: /submit project/i }));

      await waitFor(() => {
        expect(
          screen.getByText("Submission failed. Please try again."),
        ).toBeTruthy();
      });
    });
  });
});

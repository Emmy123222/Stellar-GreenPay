/**
 * @jest-environment jsdom
 *
 * Frontend tests for pages/apply.tsx — the verification request form at /apply.
 *
 * These tests use a stubbed I18nProvider that always returns the requested key
 * so we can exercise the form in English without wiring the full provider
 * tree. We also mock the project-categories import to keep the test purely
 * UX-driven.
 *
 * About queries: the apply page renders the same text in two places for
 * visual hierarchy (kicker paragraph + h1 page title), so we use
 * getByRole("heading", { name }) or getAllByText for the title. Form fields
 * are looked up by getByLabelText — the Field component deliberately keeps
 * helper/error text outside the <label> so the accessible name matches exactly.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Force the next/router `useRouter` hook to return a stub with a push() we can
// observe. mockReturnValue is sticky so we don't need beforeEach here.
jest.mock("next/router", () => ({
  useRouter: () => ({ push: jest.fn(), query: {}, pathname: "/apply" }),
}));

jest.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: jest.fn(),
  }),
}));

jest.mock("@/utils/format", () => ({
  PROJECT_CATEGORIES: [
    "Reforestation",
    "Solar Energy",
    "Ocean Conservation",
    "Clean Water",
    "Wildlife Protection",
    "Carbon Capture",
    "Wind Energy",
    "Sustainable Agriculture",
    "Other",
  ],
}));

const mockSubmit = jest.fn();
const mockUpload = jest.fn();
jest.mock("@/lib/api", () => ({
  submitVerificationRequest: (...args: unknown[]) => mockSubmit(...args),
  uploadSupportingDocument: (...args: unknown[]) => mockUpload(...args),
}));

// Stub File so JSDOM tests can simulate user uploads.
class FakeFile {
  name: string;
  size: number;
  type: string;
  constructor(name: string, size: number, type: string) {
    this.name = name;
    this.size = size;
    this.type = type;
  }
}

import ApplyPage from "@/pages/apply";

describe("ApplyPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders the first step with required organisation fields", () => {
    render(<ApplyPage />);
    // The page renders the pageTitle twice (kicker paragraph + h1 heading)
    // by design for visual hierarchy; scope the test to the heading role.
    expect(
      screen.getByRole("heading", { name: "apply.pageTitle" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("apply.orgName *")).toBeTruthy();
    expect(screen.getByLabelText("apply.contactEmail *")).toBeTruthy();
    expect(screen.getByLabelText("apply.walletAddress *")).toBeTruthy();
  });

  test("blocks next when required fields are empty", async () => {
    render(<ApplyPage />);
    fireEvent.click(screen.getByRole("button", { name: /common\.next/ }));

    // Both organisation name and contact email produce "apply.required"
    // when empty, so the validation copy appears in two <p> elements.
    // getAllByText is the right matcher.
    await waitFor(() => {
      expect(screen.getAllByText("apply.required").length).toBeGreaterThan(0);
    });
    // Should still be on the org step.
    expect(screen.getByText("apply.stepOrg")).toBeTruthy();
  });

  test("blocks invalid Stellar wallet and email", async () => {
    render(<ApplyPage />);
    fireEvent.input(screen.getByLabelText("apply.orgName *"), {
      target: { value: "Acme" },
    });
    fireEvent.input(screen.getByLabelText("apply.contactEmail *"), {
      target: { value: "not-an-email" },
    });
    fireEvent.input(screen.getByLabelText("apply.walletAddress *"), {
      target: { value: "not-a-wallet" },
    });
    fireEvent.click(screen.getByRole("button", { name: /common\.next/ }));

    await waitFor(() => {
      expect(screen.getByText("apply.invalidEmail")).toBeTruthy();
      expect(screen.getByText("apply.invalidWallet")).toBeTruthy();
    });
  });

  test("walks through the wizard and submits the form", async () => {
    mockSubmit.mockResolvedValueOnce({
      id: "abc",
      reviewTimeline: "5–10 business days",
    });
    render(<ApplyPage />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("apply.orgName *"), "Acme Climate");
    await user.type(screen.getByLabelText("apply.contactEmail *"), "hello@acme.org");
    await user.type(
      screen.getByLabelText("apply.walletAddress *"),
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );
    await user.click(screen.getByRole("button", { name: /common\.next/ }));

    // Project step
    expect(screen.getByText("apply.stepProject")).toBeTruthy();
    await user.type(screen.getByLabelText("apply.projectName *"), "Acme Solar");
    await user.type(screen.getByLabelText("apply.projectLocation *"), "Nairobi");
    await user.click(screen.getByRole("button", { name: /common\.next/ }));

    // Impact step
    expect(screen.getByText("apply.stepImpact")).toBeTruthy();
    await user.type(
      screen.getByLabelText("apply.co2PerXLM *"),
      "0.05",
    );
    await user.click(screen.getByRole("button", { name: /common\.next/ }));

    // Documents step — skip uploading, just go next
    expect(screen.getByText("apply.documentsTitle")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /common\.next/ }));

    // Review step
    expect(screen.getByText("apply.stepReview")).toBeTruthy();
    expect(screen.getByText("Acme Climate")).toBeTruthy();
    expect(screen.getByText("Acme Solar")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /apply\.submit/ }));

    await waitFor(() => {
      expect(screen.getByText("apply.subThanks")).toBeTruthy();
    });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    const submitted = mockSubmit.mock.calls[0][0];
    expect(submitted.organizationName).toBe("Acme Climate");
    expect(submitted.projectName).toBe("Acme Solar");
    expect(submitted.co2PerXLM).toBe("0.05");
    expect(submitted.supportingDocuments).toEqual([]);
  });

  test("uploads a file via api.ts.uploadSupportingDocument", async () => {
    mockUpload.mockResolvedValueOnce({
      key: "k1",
      url: "/api/uploads/k1",
      size: 1234,
      contentType: "application/pdf",
      backend: "local",
      originalName: "methodology.pdf",
    });
    render(<ApplyPage />);
    const user = userEvent.setup();

    // Forward to Documents step.
    await user.type(screen.getByLabelText("apply.orgName *"), "Acme Climate");
    await user.type(screen.getByLabelText("apply.contactEmail *"), "hello@acme.org");
    await user.type(
      screen.getByLabelText("apply.walletAddress *"),
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );
    await user.click(screen.getByRole("button", { name: /common\.next/ }));
    await user.type(screen.getByLabelText("apply.projectName *"), "Acme Solar");
    await user.type(screen.getByLabelText("apply.projectLocation *"), "Nairobi");
    await user.click(screen.getByRole("button", { name: /common\.next/ }));
    await user.type(screen.getByLabelText("apply.co2PerXLM *"), "0.05");
    await user.click(screen.getByRole("button", { name: /common\.next/ }));

    const fileInput = screen.getByLabelText(
      "apply.documentsTitle",
    ) as HTMLInputElement;
    const fake = new FakeFile("methodology.pdf", 1234, "application/pdf");
    fireEvent.change(fileInput, { target: { files: [fake] } });

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith(fake);
    });
    await waitFor(() => {
      expect(screen.getByText("methodology.pdf")).toBeTruthy();
    });
  });

  test("rejects server error messages gracefully", async () => {
    mockSubmit.mockRejectedValueOnce({
      response: { data: { error: "Backend failed. Please retry." } },
    });

    render(<ApplyPage />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("apply.orgName *"), "Acme Climate");
    await user.type(screen.getByLabelText("apply.contactEmail *"), "hello@acme.org");
    await user.type(
      screen.getByLabelText("apply.walletAddress *"),
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );
    await user.click(screen.getByRole("button", { name: /common\.next/ }));
    await user.type(screen.getByLabelText("apply.projectName *"), "Acme Solar");
    await user.type(screen.getByLabelText("apply.projectLocation *"), "Nairobi");
    await user.click(screen.getByRole("button", { name: /common\.next/ }));
    await user.type(screen.getByLabelText("apply.co2PerXLM *"), "0.05");
    await user.click(screen.getByRole("button", { name: /common\.next/ }));
    await user.click(screen.getByRole("button", { name: /common\.next/ }));
    await user.click(screen.getByRole("button", { name: /apply\.submit/ }));

    await waitFor(() => {
      expect(screen.getByText("Backend failed. Please retry.")).toBeTruthy();
    });
  });
});

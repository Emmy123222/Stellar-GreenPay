import { useState, type ComponentProps } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import MonthlyGivingSetup from "../MonthlyGivingSetup";
import { createRecurringDonation } from "@/lib/api";
import {
  MIN_MONTHLY_AMOUNT_XLM,
  MONTHLY_GIVING_STORAGE_KEY,
  loadMonthlySubscriptions,
} from "@/lib/monthlyGiving";
import type { MonthlySubscription } from "@/utils/types";

jest.mock("@/lib/api", () => ({
  createRecurringDonation: jest.fn(),
}));

const mockCreateRecurringDonation = jest.mocked(createRecurringDonation);

const PROJECT_ID = "project-123";
const PROJECT_NAME = "Amazon Reforestation Initiative";
const DONOR = "GDONORWALLET12345678901234567890123456789012345678901234";

function renderSetup(
  props: Partial<ComponentProps<typeof MonthlyGivingSetup>> = {},
) {
  const onClose = jest.fn();
  const onCreated = jest.fn();
  const view = render(
    <MonthlyGivingSetup
      projectId={PROJECT_ID}
      projectName={PROJECT_NAME}
      onClose={onClose}
      onCreated={onCreated}
      {...props}
    />,
  );
  return { ...view, onClose, onCreated };
}

function amountInput() {
  return screen.getByLabelText(/amount \(xlm\)/i);
}

function saveButton() {
  return screen.getByRole("button", { name: /save monthly giving/i });
}

function continueButton() {
  return screen.getByRole("button", { name: /continue/i });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockCreateRecurringDonation.mockResolvedValue({
    id: "pledge-1",
    donorAddress: DONOR,
    projectId: PROJECT_ID,
    projectName: PROJECT_NAME,
    amountXlm: 25,
    currency: "XLM",
    nextDueDate: "2026-01-15",
    durationMonths: 3,
    remainingMonths: 3,
    status: "active",
    createdAt: "2026-01-15T00:00:00.000Z",
  });
});

describe("MonthlyGivingSetup", () => {
  it("renders the project, default amount, duration options and empty history", () => {
    renderSetup();

    expect(
      screen.getByRole("heading", { name: "Monthly Giving Setup" }),
    ).toBeInTheDocument();
    expect(screen.getByText(PROJECT_NAME)).toBeInTheDocument();
    expect(amountInput()).toHaveValue(25);
    expect(amountInput()).toHaveAttribute("min", "1");

    expect(screen.getByRole("button", { name: "3 months" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "6 months" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "12 months" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Indefinite" })).toBeInTheDocument();

    expect(saveButton()).toBeEnabled();
    expect(
      screen.getByText("No subscriptions created for this project yet."),
    ).toBeInTheDocument();
  });

  it("enforces the backend's 1 XLM minimum for custom amounts", () => {
    renderSetup();

    fireEvent.change(amountInput(), { target: { value: "0.9999999" } });
    expect(saveButton()).toBeDisabled();

    fireEvent.change(amountInput(), { target: { value: "0" } });
    expect(saveButton()).toBeDisabled();

    fireEvent.change(amountInput(), { target: { value: "" } });
    expect(saveButton()).toBeDisabled();

    fireEvent.change(amountInput(), { target: { value: String(MIN_MONTHLY_AMOUNT_XLM) } });
    expect(saveButton()).toBeEnabled();

    fireEvent.change(amountInput(), { target: { value: "42.5" } });
    expect(saveButton()).toBeEnabled();
  });

  it("requires a start date before opening the confirmation", () => {
    renderSetup();

    const startDate = screen.getByLabelText(/start date/i);
    fireEvent.change(startDate, { target: { value: "" } });

    expect(saveButton()).toBeDisabled();
    expect(
      screen.queryByRole("heading", { name: "Confirm monthly giving" }),
    ).not.toBeInTheDocument();
  });

  it("shows the selected custom amount and duration in the confirmation", () => {
    renderSetup();

    fireEvent.change(amountInput(), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "6 months" }));
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(saveButton());

    const dialog = screen.getByRole("dialog", {
      name: "Confirm monthly giving",
    });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/40 XLM/)).toBeInTheDocument();
    expect(within(dialog).getByText("6 months")).toBeInTheDocument();
    expect(within(dialog).getByText("Next charge")).toBeInTheDocument();

    // Cancelling the confirmation returns to the form without submitting.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockCreateRecurringDonation).not.toHaveBeenCalled();
    expect(loadMonthlySubscriptions()).toHaveLength(0);
  });

  it("submits the pledge through the API and stores the created subscription", async () => {
    const { onClose, onCreated } = renderSetup({ donorAddress: DONOR });

    fireEvent.change(amountInput(), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "6 months" }));
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(saveButton());
    fireEvent.click(continueButton());

    await waitFor(() => {
      expect(mockCreateRecurringDonation).toHaveBeenCalledWith({
        donorAddress: DONOR,
        projectId: PROJECT_ID,
        amountXlm: 40,
        durationMonths: 6,
        startDate: "2026-12-31",
      });
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledTimes(1);

    const [subscription] = loadMonthlySubscriptions();
    expect(subscription).toMatchObject({
      projectId: PROJECT_ID,
      projectName: PROJECT_NAME,
      amountXLM: "40.0000000",
      durationMonths: 6,
      remainingMonths: 6,
      status: "active",
      nextDueDate: "2026-12-31T00:00:00.000Z",
    });
    expect(onCreated).toHaveBeenCalledWith(subscription.id);
  });

  it("leaves the setup and shows the success state after submitting", async () => {
    const onCreated = jest.fn();

    function SuccessHarness() {
      const [open, setOpen] = useState(true);
      return open ? (
        <MonthlyGivingSetup
          projectId={PROJECT_ID}
          projectName={PROJECT_NAME}
          donorAddress={DONOR}
          onClose={() => setOpen(false)}
          onCreated={onCreated}
        />
      ) : (
        <p>Monthly giving active</p>
      );
    }

    render(<SuccessHarness />);

    fireEvent.change(amountInput(), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "12 months" }));
    fireEvent.click(saveButton());
    fireEvent.click(continueButton());

    expect(await screen.findByText("Monthly giving active")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Monthly Giving Setup" }),
    ).not.toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(loadMonthlySubscriptions()[0]).toMatchObject({
      amountXLM: "30.0000000",
      durationMonths: 12,
      status: "active",
    });
  });

  it("keeps the confirmation open and reports an API failure", async () => {
    mockCreateRecurringDonation.mockRejectedValue(new Error("network down"));
    const { onClose, onCreated } = renderSetup({ donorAddress: DONOR });

    fireEvent.click(saveButton());
    fireEvent.click(continueButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save your monthly pledge. Please try again.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(loadMonthlySubscriptions()).toHaveLength(0);
    expect(
      screen.getByRole("dialog", { name: "Confirm monthly giving" }),
    ).toBeInTheDocument();
  });

  it("creates indefinite pledges locally without a backend duration", async () => {
    const { onClose, onCreated } = renderSetup({ donorAddress: DONOR });

    fireEvent.click(screen.getByRole("button", { name: "Indefinite" }));
    fireEvent.click(saveButton());
    fireEvent.click(continueButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockCreateRecurringDonation).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledTimes(1);

    const [subscription]: MonthlySubscription[] = loadMonthlySubscriptions();
    expect(subscription.durationMonths).toBeNull();
    expect(subscription.remainingMonths).toBeNull();
  });

  it("lists existing subscriptions for the current project only", () => {
    const base: MonthlySubscription = {
      id: "sub_existing",
      projectId: PROJECT_ID,
      projectName: PROJECT_NAME,
      amountXLM: "25.0000000",
      startDate: "2026-01-01T00:00:00.000Z",
      durationMonths: 3,
      nextDueDate: "2026-02-01T00:00:00.000Z",
      remainingMonths: 2,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      history: [],
    };
    window.localStorage.setItem(
      MONTHLY_GIVING_STORAGE_KEY,
      JSON.stringify([
        base,
        { ...base, id: "sub_other", projectId: "other-project" },
      ]),
    );

    renderSetup();

    expect(screen.getByText(/25 XLM monthly/)).toBeInTheDocument();
    expect(screen.queryByText(/other-project/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/No paid months yet/)).toHaveLength(1);
  });
});

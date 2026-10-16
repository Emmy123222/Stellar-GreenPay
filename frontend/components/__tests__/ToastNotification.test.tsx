import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ToastNotification, { ToastItem } from "../ToastNotification";

describe("ToastNotification Accessibility", () => {
  it("renders status / success toasts inside a polite live region", () => {
    const toasts: ToastItem[] = [
      {
        id: "toast-1",
        title: "Donation successful!",
        description: "Your donation of 50 XLM was received",
        type: "success",
        createdAt: 1000,
      },
    ];

    render(<ToastNotification toasts={toasts} onDismiss={jest.fn()} />);

    const statusRegion = screen.getByRole("status");
    expect(statusRegion).toBeInTheDocument();
    expect(statusRegion).toHaveAttribute("aria-live", "polite");
    expect(statusRegion).toHaveAttribute("aria-atomic", "true");
    expect(statusRegion).toHaveTextContent("Donation successful!");
    expect(statusRegion).toHaveTextContent("Your donation of 50 XLM was received");

    // No error alerts should be present
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("defaults un-typed toasts to polite status live regions", () => {
    const toasts: ToastItem[] = [
      {
        id: "toast-default",
        title: "New badge earned!",
        description: "You earned the Forest badge",
        createdAt: 1000,
      },
    ];

    render(<ToastNotification toasts={toasts} onDismiss={jest.fn()} />);

    const statusRegion = screen.getByRole("status");
    expect(statusRegion).toBeInTheDocument();
    expect(statusRegion).toHaveAttribute("aria-live", "polite");
    expect(statusRegion).toHaveTextContent("New badge earned!");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders error toasts inside an assertive live region", () => {
    const toasts: ToastItem[] = [
      {
        id: "toast-err",
        title: "Transaction failed",
        description: "Insufficient balance to complete donation",
        type: "error",
        createdAt: 1000,
      },
    ];

    render(<ToastNotification toasts={toasts} onDismiss={jest.fn()} />);

    const alertRegion = screen.getByRole("alert");
    expect(alertRegion).toBeInTheDocument();
    expect(alertRegion).toHaveAttribute("aria-live", "assertive");
    expect(alertRegion).toHaveAttribute("aria-atomic", "true");
    expect(alertRegion).toHaveTextContent("Transaction failed");
    expect(alertRegion).toHaveTextContent("Insufficient balance to complete donation");

    // No status region when only errors exist
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("supports both polite status and assertive error toasts simultaneously", () => {
    const toasts: ToastItem[] = [
      {
        id: "toast-status",
        title: "Sync in progress",
        type: "status",
        createdAt: 1000,
      },
      {
        id: "toast-error",
        title: "Horizon timeout",
        type: "error",
        createdAt: 2000,
      },
    ];

    render(<ToastNotification toasts={toasts} onDismiss={jest.fn()} />);

    const statusRegion = screen.getByRole("status");
    expect(statusRegion).toHaveAttribute("aria-live", "polite");
    expect(statusRegion).toHaveTextContent("Sync in progress");

    const alertRegion = screen.getByRole("alert");
    expect(alertRegion).toHaveAttribute("aria-live", "assertive");
    expect(alertRegion).toHaveTextContent("Horizon timeout");
  });

  it("invokes onDismiss callback when dismiss button is clicked", async () => {
    const user = userEvent.setup();
    const handleDismiss = jest.fn();
    const toasts: ToastItem[] = [
      {
        id: "toast-dismiss",
        title: "Dismissible alert",
        type: "error",
        createdAt: 1000,
      },
    ];

    render(<ToastNotification toasts={toasts} onDismiss={handleDismiss} />);

    const dismissButton = screen.getByRole("button", { name: /dismiss notification/i });
    await user.click(dismissButton);

    expect(handleDismiss).toHaveBeenCalledWith("toast-dismiss");
  });

  it("renders nothing when toasts array is empty", () => {
    const { container } = render(<ToastNotification toasts={[]} onDismiss={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});

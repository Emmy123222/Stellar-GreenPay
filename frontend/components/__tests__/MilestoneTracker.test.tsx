import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MilestoneTracker from "../MilestoneTracker";

const milestone = {
  id: "m1",
  title: "Plant 1000 trees",
  description: "First planting round",
  targetDate: "2026-01-01",
  completedAt: null,
  order: 1,
};

describe("MilestoneTracker completion confirmation", () => {
  it("shows a pending state while in flight and reverts on failure", async () => {
    let rejectCompletion: (err: unknown) => void = () => {};
    const onComplete = jest.fn(
      () => new Promise<void>((_resolve, reject) => { rejectCompletion = reject; }),
    );

    render(<MilestoneTracker milestones={[milestone]} isAdmin onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: /mark complete/i }));

    // Milestone is not marked complete until the transaction is confirmed.
    expect(await screen.findByRole("status")).toHaveTextContent(/pending confirmation/i);

    rejectCompletion(new Error("tx failed"));

    await waitFor(() => {
      expect(screen.getByText(/transaction failed/i)).toBeInTheDocument();
    });
    // Reverted: the milestone still shows an actionable "Mark Complete" button.
    expect(screen.getByRole("button", { name: /mark complete/i })).toBeInTheDocument();
  });

  it("re-syncs confirmed state after a successful completion", async () => {
    const onComplete = jest.fn().mockResolvedValue(undefined);
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    render(
      <MilestoneTracker
        milestones={[milestone]}
        isAdmin
        onComplete={onComplete}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /mark complete/i }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });
});

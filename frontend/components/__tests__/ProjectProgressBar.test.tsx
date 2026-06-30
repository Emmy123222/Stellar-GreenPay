import { render, screen } from "@testing-library/react";
import ProjectProgressBar from "../ProjectProgressBar";

describe("ProjectProgressBar", () => {
  it("shows a calculated percentage when a goal is set", () => {
    render(<ProjectProgressBar raisedXLM={2500} goalXLM={10000} />);

    expect(screen.getByText("25%" )).toBeInTheDocument();
    expect(screen.getByText(/2,500/i)).toBeInTheDocument();
    expect(screen.getByText(/10,000/i)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });

  it("shows a no-goal message when the goal is missing", () => {
    render(<ProjectProgressBar raisedXLM={2500} goalXLM={0} />);

    expect(screen.getByText("No goal set")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});

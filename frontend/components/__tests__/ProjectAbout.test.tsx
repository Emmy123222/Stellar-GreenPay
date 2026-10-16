import { render, screen } from "@testing-library/react";
import ProjectAbout from "../ProjectAbout";

describe("ProjectAbout", () => {
  it("renders description and tags", () => {
    render(
      <ProjectAbout
        description="A great climate project description that explains everything in detail."
        tags={["solar", "clean-energy"]}
      />
    );

    expect(screen.getByText("About this Project")).toBeInTheDocument();
    expect(screen.getByText(/A great climate project description/)).toBeInTheDocument();
    expect(screen.getByText("solar")).toBeInTheDocument();
    expect(screen.getByText("clean-energy")).toBeInTheDocument();
  });
});

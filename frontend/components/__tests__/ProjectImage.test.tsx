import { render, screen } from "@testing-library/react";
import ProjectImage from "../ProjectImage";

const baseProps = {
  name: "Amazon Reforestation",
  description: "Restoring native tree cover across degraded rainforest land.",
};

describe("ProjectImage alt-text rules", () => {
  it("uses description as alt text when provided", () => {
    render(<ProjectImage src="https://example.com/img.png" {...baseProps} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("alt", "Restoring native tree cover across degraded rainforest land.");
    expect(img).not.toHaveAttribute("role");
  });

  it("falls back to project name when no description", () => {
    render(<ProjectImage src="https://example.com/img.png" name={baseProps.name} />);
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("alt", "Amazon Reforestation");
    expect(img).not.toHaveAttribute("role");
  });

  it("uses explicit alt prop when provided", () => {
    render(
      <ProjectImage
        src="https://example.com/img.png"
        {...baseProps}
        alt="Custom alt text"
      />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("alt", "Custom alt text");
  });

  it('decorative images get alt="" and role=presentation', () => {
    render(
      <ProjectImage
        src="https://example.com/img.png"
        {...baseProps}
        decorative
      />,
    );
    const img = screen.getByRole("presentation");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("role", "presentation");
  });

  it('placeholder gets alt="" and role=presentation when no src', () => {
    render(<ProjectImage {...baseProps} />);
    const img = screen.getByRole("presentation");
    expect(img).toHaveAttribute("src", "/project-placeholder.svg");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("role", "presentation");
  });

  it("placeholder is not announced as project-placeholder by screen readers", () => {
    render(<ProjectImage {...baseProps} />);
    const img = screen.getByRole("presentation");
    expect(screen.queryByRole("img", { name: /project-placeholder/i })).not.toBeInTheDocument();
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("role", "presentation");
  });
});

import { render, screen, fireEvent } from "@testing-library/react";
import ProjectUpdatesFeed, { renderMarkdown } from "../ProjectUpdatesFeed";
import type { ProjectUpdate } from "@/utils/types";

// Mock useI18n
jest.mock("@/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "project.projectUpdates": "Project Updates",
        "project.noUpdatesYet": "No updates yet. Check back soon!",
      };
      return translations[key] || key;
    },
  }),
}));

const mockUpdates: ProjectUpdate[] = [
  {
    id: "up-1",
    projectId: "proj-1",
    title: "10,000 Trees Planted",
    body: "We have reached our **first milestone**! Check [our report](https://example.com).",
    createdAt: "2025-01-01T00:00:00.000Z",
  },
];

describe("ProjectUpdatesFeed", () => {
  it("renders empty state when there are no updates", () => {
    render(
      <ProjectUpdatesFeed
        updates={[]}
        updateLikes={{}}
        publicKey={null}
        onToggleLike={jest.fn()}
      />
    );

    expect(screen.getByText("No updates yet. Check back soon!")).toBeInTheDocument();
  });

  it("renders updates with title, formatted markdown, and like button", () => {
    const onToggleLike = jest.fn();
    render(
      <ProjectUpdatesFeed
        updates={mockUpdates}
        updateLikes={{ "up-1": { liked: true, likeCount: 7 } }}
        publicKey="GABC"
        onToggleLike={onToggleLike}
      />
    );

    expect(screen.getByText("10,000 Trees Planted")).toBeInTheDocument();
    expect(screen.getByText("first milestone")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();

    const likeBtn = screen.getByRole("button");
    fireEvent.click(likeBtn);
    expect(onToggleLike).toHaveBeenCalledWith("up-1");
  });

  it("renderMarkdown helper converts bold, italic, links, and line breaks", () => {
    const md = "**Bold text** and *italic* and [link](https://test.com)\nNew line";
    const html = renderMarkdown(md);
    expect(html).toContain("<strong>Bold text</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('<a href="https://test.com"');
    expect(html).toContain("<br />");
  });
});

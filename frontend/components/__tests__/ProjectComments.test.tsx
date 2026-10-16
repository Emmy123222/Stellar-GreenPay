import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ProjectComments from "../ProjectComments";
import { fetchProjectComments, postProjectComment, deleteProjectComment } from "@/lib/api";
import type { ProjectComment } from "@/utils/types";

jest.mock("@/lib/api", () => ({
  fetchProjectComments: jest.fn(),
  postProjectComment: jest.fn(),
  deleteProjectComment: jest.fn(),
}));

const DONOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function comment(overrides: Partial<ProjectComment> = {}): ProjectComment {
  return {
    id: "c1",
    projectId: "p1",
    authorAddress: DONOR,
    authorDisplayName: null,
    body: "Proud to support this!",
    moderationStatus: "approved",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const mockFetch = fetchProjectComments as jest.Mock;
const mockPost = postProjectComment as jest.Mock;
const mockDelete = deleteProjectComment as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ProjectComments", () => {
  it("shows the empty state when there are no comments", async () => {
    mockFetch.mockResolvedValue({ success: true, data: [], next_cursor: null, has_more: false });
    render(<ProjectComments projectId="p1" publicKey={null} />);

    expect(await screen.findByText(/No comments yet/)).toBeInTheDocument();
    expect(screen.getByText(/Connect your wallet to join the discussion/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders comments for anonymous visitors", async () => {
    mockFetch.mockResolvedValue({
      success: true,
      data: [comment(), comment({ id: "c2", authorDisplayName: "Ada", body: "Second" })],
      next_cursor: null,
      has_more: false,
    });
    render(<ProjectComments projectId="p1" publicKey={null} />);

    expect(await screen.findByText("Proud to support this!")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("posts an approved comment to the top of the thread", async () => {
    mockFetch.mockResolvedValue({ success: true, data: [], next_cursor: null, has_more: false });
    mockPost.mockResolvedValue(comment({ id: "new", body: "Hello there" }));
    render(<ProjectComments projectId="p1" publicKey={DONOR} />);

    await screen.findByText(/No comments yet/);
    fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: "  Hello there " } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));

    expect(await screen.findByText("Hello there")).toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledWith("p1", "Hello there");
    expect(screen.getByLabelText("Add a comment")).toHaveValue("");
  });

  it("tells the donor when a comment is held for review", async () => {
    mockFetch.mockResolvedValue({ success: true, data: [], next_cursor: null, has_more: false });
    mockPost.mockResolvedValue(comment({ id: "new", body: "see https://x", moderationStatus: "pending_review" }));
    render(<ProjectComments projectId="p1" publicKey={DONOR} />);

    await screen.findByText(/No comments yet/);
    fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: "see https://x" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/once a moderator has reviewed it/);
    expect(screen.queryByText("see https://x")).not.toBeInTheDocument();
  });

  it.each([
    [{ status: 429, data: { message: "Too many requests" } }, /commenting too quickly/],
    [{ status: 403, data: { error: "Only donors who have donated to this project can comment" } }, /Only donors/],
    [{ status: 422, data: { error: "The comment failed content moderation.", code: "comment_rejected" } }, /failed content moderation/],
  ])("surfaces backend errors (%o)", async (response, expected) => {
    mockFetch.mockResolvedValue({ success: true, data: [], next_cursor: null, has_more: false });
    mockPost.mockRejectedValue({ response });
    render(<ProjectComments projectId="p1" publicKey={DONOR} />);

    await screen.findByText(/No comments yet/);
    fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
  });

  it("lets the author delete their own comment", async () => {
    mockFetch.mockResolvedValue({ success: true, data: [comment()], next_cursor: null, has_more: false });
    mockDelete.mockResolvedValue(undefined);
    render(<ProjectComments projectId="p1" publicKey={DONOR} />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete your comment" }));
    await waitFor(() => expect(screen.queryByText("Proud to support this!")).not.toBeInTheDocument());
    expect(mockDelete).toHaveBeenCalledWith("c1");
  });

  it("loads more with the cursor", async () => {
    mockFetch
      .mockResolvedValueOnce({ success: true, data: [comment()], next_cursor: "abc", has_more: true })
      .mockResolvedValueOnce({ success: true, data: [comment({ id: "c2", body: "Older" })], next_cursor: null, has_more: false });
    render(<ProjectComments projectId="p1" publicKey={null} />);

    fireEvent.click(await screen.findByRole("button", { name: "Load more comments" }));
    expect(await screen.findByText("Older")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenLastCalledWith("p1", { cursor: "abc" });
  });
});

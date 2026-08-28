/**
 * lib/__tests__/github.test.ts
 *
 * Unit tests for the /contributors data source (issue #726). These verify
 * that only merged pull requests are surfaced, that non-feature labels
 * (triage/process labels) are skipped when deriving the feature tag, and
 * that unlabeled PRs fall back to a sensible default.
 */
import { fetchMergedPullRequests } from "@/lib/github";

function mockPullRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    number: 1,
    title: "Some PR",
    html_url: "https://github.com/Emmy123222/Stellar-GreenPay/pull/1",
    merged_at: "2026-08-01T00:00:00Z",
    labels: [],
    user: {
      login: "octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
      html_url: "https://github.com/octocat",
    },
    ...overrides,
  };
}

describe("fetchMergedPullRequests", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("filters out closed-but-unmerged pull requests", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        mockPullRequest({ id: 1, merged_at: "2026-08-01T00:00:00Z" }),
        mockPullRequest({ id: 2, merged_at: null }),
      ],
    }) as unknown as typeof fetch;

    const result = await fetchMergedPullRequests();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("picks a feature label over process/triage labels", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        mockPullRequest({
          labels: [{ name: "Stellar Wave" }, { name: "feature" }],
        }),
      ],
    }) as unknown as typeof fetch;

    const result = await fetchMergedPullRequests();

    expect(result[0].feature).toBe("feature");
  });

  it("falls back to a default feature tag when no labels are present", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [mockPullRequest({ labels: [] })],
    }) as unknown as typeof fetch;

    const result = await fetchMergedPullRequests();

    expect(result[0].feature).toBe("Improvement");
  });

  it("throws when the GitHub API responds with an error status", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }) as unknown as typeof fetch;

    await expect(fetchMergedPullRequests()).rejects.toThrow(/403/);
  });
});

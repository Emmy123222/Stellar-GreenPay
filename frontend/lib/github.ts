/**
 * lib/github.ts
 * Fetches merged pull requests from the public GitHub API for the
 * contributor attribution timeline (/contributors).
 */
import type { ContributorPR } from "@/utils/types";

const GITHUB_API_BASE = "https://api.github.com";
const REPO_OWNER = process.env.GITHUB_REPO_OWNER || "Emmy123222";
const REPO_NAME = process.env.GITHUB_REPO_NAME || "Stellar-GreenPay";

// Labels that describe process/triage rather than a shippable feature —
// excluded when picking the label used as the PR's "feature" tag.
const NON_FEATURE_LABELS = new Set([
  "stellar wave",
  "good first issue",
  "help wanted",
  "bug",
  "documentation",
  "chore",
  "dependencies",
]);

interface GitHubLabel {
  name?: string;
}

interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  labels?: (GitHubLabel | string)[];
  user: {
    login: string;
    avatar_url: string;
    html_url: string;
  } | null;
}

function deriveFeature(pr: GitHubPullRequest): string {
  const labelNames = (pr.labels ?? [])
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter((name): name is string => Boolean(name));

  const featureLabel = labelNames.find(
    (name) => !NON_FEATURE_LABELS.has(name.toLowerCase())
  );

  return featureLabel ?? "Improvement";
}

/**
 * Fetches the most recently merged pull requests for the project, mapped
 * into the shape the contributor timeline renders.
 */
export async function fetchMergedPullRequests(
  limit = 20
): Promise<ContributorPR[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
    { headers }
  );

  if (!res.ok) {
    throw new Error(`GitHub API request failed with status ${res.status}`);
  }

  const pullRequests: GitHubPullRequest[] = await res.json();

  return pullRequests
    .filter((pr) => pr.merged_at && pr.user)
    .slice(0, limit)
    .map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      htmlUrl: pr.html_url,
      mergedAt: pr.merged_at as string,
      feature: deriveFeature(pr),
      author: {
        login: pr.user!.login,
        avatarUrl: pr.user!.avatar_url,
        htmlUrl: pr.user!.html_url,
      },
    }));
}

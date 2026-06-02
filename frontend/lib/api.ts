/**
 * lib/api.ts — Backend HTTP client
 */
import axios from "axios";
import type {
  ClimateProject,
  Donation,
  DonorProfile,
  FreelancerProfile,
  ProjectUpdate,
  LeaderboardEntry,
  EscrowJob,
  ProjectCampaign,
} from "@/utils/types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
  withCredentials: true,
});

// All API routes are served under the versioned `/api/v1` prefix (issue #204).
// Rewrite `/api/*` request paths to `/api/v1/*` from a single place so every
// helper below stays on the unversioned path string.
api.interceptors.request.use((config) => {
  if (config.url && config.url.startsWith("/api/") && !config.url.startsWith("/api/v1/")) {
    config.url = config.url.replace(/^\/api\//, "/api/v1/");
  }
  return config;
});

let csrfToken: string | null = null;

async function refreshCsrfToken() {
  const { data } = await api.get<{ success: boolean; csrfToken: string }>(
    "/api/csrf-token",
  );
  csrfToken = data.csrfToken;
  return csrfToken;
}

api.interceptors.request.use(async (config) => {
  const method = config.method?.toUpperCase();
  const isMutating = method && ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  if (isMutating) {
    if (!csrfToken) {
      await refreshCsrfToken();
    }

    if (csrfToken) {
      config.headers = {
        ...config.headers,
        "X-CSRF-Token": csrfToken,
      };
    }
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 403 && !error.config.__csrfRetry) {
      error.config.__csrfRetry = true;
      csrfToken = null;
      await refreshCsrfToken();
      if (csrfToken) {
        error.config.headers = {
          ...error.config.headers,
          "X-CSRF-Token": csrfToken,
        };
        return api.request(error.config);
      }
    }

    return Promise.reject(error);
  },
);

export async function csrfFetch(input: RequestInfo, init: RequestInit = {}) {
  const method = init.method?.toUpperCase() || "GET";
  const needsToken = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  if (needsToken) {
    if (!csrfToken) {
      await refreshCsrfToken();
    }

    init.headers = {
      ...(init.headers as Record<string, string>),
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken ?? "",
    };
    init.credentials = "include";
  }

  return fetch(input, init);
}

// ── Projects ──────────────────────────────────────────────────────────────────
export async function fetchProjects(params?: {
  category?: string;
  status?: string;
  verified?: boolean;
  search?: string;
  limit?: number;
}) {
  const { data } = await api.get<{ success: boolean; data: ClimateProject[] }>(
    "/api/projects",
    { params },
  );
  return data.data;
}

export async function fetchProject(id: string) {
  const { data } = await api.get<{ success: boolean; data: ClimateProject }>(
    `/api/projects/${id}`,
  );
  return data.data;
}

export interface AISummaryResponse {
  aiSummary: string;
  aiSummaryGeneratedAt: string;
  aiSummaryModel: string;
  aiSummarySourceHash: string;
}

/**
 * Trigger backend AI-summary generation for a project. Server-side this is
 * gated to the project owner (caller's `adminAddress` must equal the
 * project's wallet address), so this should only be called from the admin
 * "Refresh summary" path.
 */
export async function generateProjectSummary(
  projectId: string,
  adminAddress: string,
): Promise<AISummaryResponse> {
  const { data } = await api.post<{ success: boolean; data: AISummaryResponse }>(
    `/api/projects/${projectId}/generate-summary`,
    { adminAddress },
  );
  return data.data;
}

export async function createProjectCampaign(
  projectId: string,
  payload: {
    title: string;
    goalXLM: string;
    deadline: string;
    description?: string;
  },
) {
  const { data } = await api.post<{ success: boolean; data: ProjectCampaign }>(
    `/api/projects/${projectId}/campaigns`,
    payload,
  );
  return data.data;
}

// ── Matching ──────────────────────────────────────────────────────────────────
export async function fetchProjectMatches(projectId: string) {
  const { data } = await api.get<{
    success: boolean;
    data: Array<{
      id: string;
      projectId: string;
      matcherAddress: string;
      capXLM: string;
      multiplier: number;
      matchedXLM: string;
      remainingXLM: string;
      expiresAt: string;
      createdAt: string;
    }>;
  }>(`/api/projects/${projectId}/matching`);
  return data.data;
}

// ── Donations ─────────────────────────────────────────────────────────────────
export async function recordDonation(payload: {
  projectId: string;
  donorAddress: string;
  amountXLM?: string;
  amount?: string;
  currency?: "XLM" | "USDC";
  message?: string;
  transactionHash: string;
}) {
  const { data } = await api.post<{ success: boolean; data: Donation }>(
    "/api/donations",
    payload,
  );
  return data.data;
}

export async function fetchProjectDonations(
  projectId: string,
  limit = 20,
  cursor?: string,
) {
  const params: { limit: number; cursor?: string } = { limit };
  if (cursor) params.cursor = cursor;
  const { data } = await api.get<{
    success: boolean;
    data: Donation[];
    nextCursor: string | null;
  }>(`/api/donations/project/${projectId}`, { params });
  return { donations: data.data, nextCursor: data.nextCursor };
}

export async function fetchProjectDonationMessages(projectId: string, limit = 10) {
  const { data } = await api.get<{ success: boolean; data: Donation[] }>(
    `/api/donations/project/${projectId}/messages`,
    { params: { limit } },
  );
  return data.data;
}

export async function fetchDonorHistory(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Donation[] }>(
    `/api/donations/donor/${publicKey}`,
  );
  return data.data;
}

// ── Profiles ──────────────────────────────────────────────────────────────────
export async function fetchProfile(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: DonorProfile }>(
    `/api/profiles/${publicKey}`,
  );
  return data.data;
}

export async function fetchFreelancerProfile(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: FreelancerProfile }>(
    `/api/profiles/${publicKey}`,
  );
  return data.data;
}

export async function upsertProfile(
  payload: Partial<DonorProfile> & { publicKey: string },
) {
  const { data } = await api.post<{ success: boolean; data: DonorProfile }>(
    "/api/profiles",
    payload,
  );
  return data.data;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
export async function fetchLeaderboard(limit = 20, period = "all") {
  const { data } = await api.get<{
    success: boolean;
    data: LeaderboardEntry[];
  }>("/api/leaderboard", { params: { limit, period } });
  return data.data;
}

// ── Jobs (escrow) ───────────────────────────────────────────────────────────
export async function fetchJobs() {
  const { data } = await api.get<{ success: boolean; data: EscrowJob[] }>(
    "/api/jobs",
  );
  return data.data;
}

export async function fetchJob(id: string) {
  const { data } = await api.get<{ success: boolean; data: EscrowJob }>(
    `/api/jobs/${id}`,
  );
  return data.data;
}

/**
 * Mark job completed after on-chain release_escrow succeeds (stores release tx hash).
 */
export async function completeJobRelease(
  jobId: string,
  releaseTransactionHash: string,
) {
  const { data } = await api.patch<{ success: boolean; data: EscrowJob }>(
    `/api/jobs/${jobId}/release`,
    { releaseTransactionHash },
  );
  return data.data;
}

// ── Project Updates ─────────────────────────────────────────────
export async function fetchProjectUpdates(projectId: string) {
  const { data } = await api.get<{ success: boolean; data: ProjectUpdate[] }>(
    `/api/updates/${projectId}`,
  );
  return data.data;
}

export async function createProjectUpdate(payload: {
  projectId: string;
  title: string;
  body: string;
  adminKey?: string;
}) {
  const { data } = await api.post<{ success: boolean; data: ProjectUpdate }>(
    "/api/updates",
    payload,
  );
  return data.data;
}

// ── Subscriptions ────────────────────────────────────────────────
export async function subscribeToProject(payload: {
  projectId: string;
  email: string;
  donorAddress?: string;
}) {
  const { data } = await api.post<{ success: boolean; message: string }>(
    "/api/subscriptions",
    payload,
  );
  return data;
}

export async function fetchSubscriberCount(projectId: string) {
  const { data } = await api.get<{ success: boolean; count: number }>(
    `/api/subscriptions/${projectId}/count`,
  );
  return data.count;
}

// ── Global Stats ─────────────────────────────────────────────────
export interface GlobalStats {
  totalDonations: number;
  totalXLMRaised: string;
  totalCO2OffsetKg: number;
}

export async function fetchGlobalStats(): Promise<GlobalStats> {
  const { data } = await api.get<{ success: boolean; data: GlobalStats }>(
    "/api/stats/global",
  );
  return data.data;
}

// ── Admin: Project Approval ──────────────────────────────────────
export async function updateProjectStatus(
  projectId: string,
  status: "active" | "rejected" | "paused",
  reason?: string,
) {
  const { data } = await api.patch<{ success: boolean; data: ClimateProject }>(
    `/api/projects/${projectId}/status`,
    { status, reason },
  );
  return data.data;
}

export async function registerProjectOnChain(payload: {
  projectId: string;
  name: string;
  wallet: string;
  co2PerXLM: number;
  adminAddress: string;
}) {
  const { data } = await api.post<{ success: boolean; xdr: string }>(
    "/api/projects/admin/register",
    payload,
  );
  return data;
}

export async function confirmProjectRegistration(payload: {
  projectId: string;
  transactionHash: string;
}) {
  const { data } = await api.post<{ success: boolean; data: ClimateProject }>(
    "/api/projects/admin/confirm",
    payload,
  );
  return data;
}

// ── Update Likes ─────────────────────────────────────────────────
export async function toggleUpdateLike(updateId: string, donorAddress: string) {
  const { data } = await api.post<{ success: boolean; data: { liked: boolean; likeCount: number } }>(
    `/api/updates/${updateId}/like`,
    { donorAddress },
  );
  return data.data;
}

export async function fetchUpdateLikes(updateId: string, donorAddress?: string) {
  const params: Record<string, string> = {};
  if (donorAddress) params.donorAddress = donorAddress;
  const { data } = await api.get<{ success: boolean; data: { liked: boolean; likeCount: number } }>(
    `/api/updates/${updateId}/likes`,
    { params },
  );
  return data.data;
}

// ── Featured Project ─────────────────────────────────────────────
export async function fetchFeaturedProject(): Promise<ClimateProject | null> {
  try {
    const { data } = await api.get<{ success: boolean; data: ClimateProject }>(
      "/api/projects/featured",
    );
    return data.data;
  } catch {
    return null;
  }
}

// ── Category Stats ───────────────────────────────────────────────
export interface CategoryStats {
  category: string;
  count: number;
}

export async function fetchCategoryStats(): Promise<CategoryStats[]> {
  const { data } = await api.get<{ success: boolean; data: CategoryStats[] }>(
    "/api/stats/categories",
  );
  return data.data;
}

// ── Impact Aggregation ───────────────────────────────────────────────────────
export interface ImpactProjectStats {
  totalDonationsXLM: string;
  donorCount: number;
  co2OffsetKg: number;
  treesEquivalent: number;
  uniqueCountries: number;
}

export interface ImpactCategoryBreakdownItem {
  category: string;
  totalDonationsXLM: string;
  donorCount: number;
  co2OffsetKg: number;
}

export interface ImpactGlobalStats extends ImpactProjectStats {
  breakdownByCategory: ImpactCategoryBreakdownItem[];
}

export interface ImpactDonorStats {
  totalDonatedXLM: string;
  co2OffsetKg: number;
  projectsSupported: number;
  topCategory: string | null;
}

export async function fetchImpactProject(projectId: string): Promise<ImpactProjectStats> {
  const { data } = await api.get<{ success: boolean; data: ImpactProjectStats }>(
    `/api/impact/project/${projectId}`,
  );
  return data.data;
}

export async function fetchImpactGlobal(): Promise<ImpactGlobalStats> {
  const { data } = await api.get<{ success: boolean; data: ImpactGlobalStats }>(
    "/api/impact/global",
  );
  return data.data;
}

export async function fetchImpactDonor(publicKey: string): Promise<ImpactDonorStats> {
  const { data } = await api.get<{ success: boolean; data: ImpactDonorStats }>(
    `/api/impact/donor/${publicKey}`,
  );
  return data.data;
}

export interface SubmitProjectPayload {
  name: string;
  category: string;
  description: string;
  location: string;
  goalXLM: string;
  walletAddress: string;
  organization: {
    name: string;
    website: string;
    country: string;
    contactEmail: string;
  };
  co2Methodology: {
    name: string;
    verificationBody: string;
    annualTonnesCO2: string;
    documentUrl: string;
  };
}

export interface SubmitProjectResponse {
  id: string;
  reviewTimeline: string;
}

export async function submitProject(payload: SubmitProjectPayload): Promise<SubmitProjectResponse> {
  const { data } = await api.post<{ success: boolean; data: SubmitProjectResponse }>(
    "/api/projects",
    payload,
  );
  return data.data;
}

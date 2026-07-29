/**
 * lib/api.ts — Backend HTTP client
 *
 * Typed helper functions for calling the GreenPay backend from the Next.js app.
 * Each function maps closely to a backend route and returns the unwrapped `data`
 * payload from the API response.
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
      config.headers.set("X-CSRF-Token", csrfToken);
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
/**
 * Fetch a list of climate projects from the backend.
 *
 * @param params - Optional server-side filters.
 * @returns A list of projects matching the query.
 * @throws If the request fails (network error, timeout, or non-2xx response).
 *
 * @example
 * const projects = await fetchProjects({ verified: true, limit: 12 });
 * console.log("projects:", projects.length);
 */
export async function fetchProjects(params?: {
  category?: string;
  status?: string;
  verified?: boolean;
  search?: string;
  limit?: number;
}): Promise<ClimateProject[]> {
  const { data } = await api.get<{ success: boolean; data: ClimateProject[] }>(
    "/api/projects",
    { params },
  );
  return data.data;
}

/**
 * Fetch a single project by its id.
 *
 * @param id - Project id.
 * @returns The project.
 * @throws If the request fails (including 404s for missing projects).
 */
export async function fetchProject(id: string) {
  const { data } = await api.get<{ success: boolean; data: ClimateProject }>(
    `/api/projects/${id}`,
    { params },
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
/**
 * Persist a completed donation in the backend after the on-chain transaction succeeds.
 *
 * @param payload - Donation details, including the on-chain transaction hash.
 * @returns The stored donation record.
 * @throws If the request fails or validation is rejected by the backend.
 *
 * @example
 * await recordDonation({
 *   projectId: "project_123",
 *   donorAddress: "G...YOUR_PUBLIC_KEY...",
 *   amountXLM: "10",
 *   currency: "XLM",
 *   message: "Keep it up!",
 *   transactionHash: "abc123deadbeef",
 * });
 */
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

/**
 * Fetch donations for a project using cursor pagination.
 *
 * @param projectId - Project id.
 * @param limit - Maximum number of donations to return (default: 20).
 * @param cursor - Optional cursor from a previous call.
 * @returns Donations page and a cursor for the next page (or `null` when done).
 * @throws If the request fails.
 */
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

/**
 * Fetch all donations made by a donor.
 *
 * @param publicKey - Donor Stellar public key.
 * @returns Donation history.
 * @throws If the request fails.
 */
export async function fetchDonorHistory(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Donation[] }>(
    `/api/donations/donor/${publicKey}`,
  );
  return data.data;
}

// ── Profiles ──────────────────────────────────────────────────────────────────
/**
 * Fetch a donor profile by public key.
 *
 * @param publicKey - Donor Stellar public key.
 * @returns Donor profile.
 * @throws If the request fails.
 */
export async function fetchProfile(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: DonorProfile }>(
    `/api/profiles/${publicKey}`,
  );
  return data.data;
}

/**
 * Fetch a freelancer profile by public key.
 *
 * @param publicKey - Freelancer Stellar public key.
 * @returns Freelancer profile.
 * @throws If the request fails.
 */
export async function fetchFreelancerProfile(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: FreelancerProfile }>(
    `/api/profiles/${publicKey}`,
  );
  return data.data;
}

/**
 * Create or update a donor profile.
 *
 * @param payload - Profile fields to upsert.
 * @returns The upserted profile.
 * @throws If the request fails or validation is rejected by the backend.
 */
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
/**
 * Fetch top donors.
 *
 * @param limit - Maximum number of entries to return (default: 20).
 * @returns Leaderboard entries.
 * @throws If the request fails.
 */
export async function fetchLeaderboard(limit = 20) {
  const { data } = await api.get<{
    success: boolean;
    data: LeaderboardEntry[];
  }>("/api/leaderboard", { params: { limit, period } });
  return data.data;
}

// ── Jobs (escrow) ───────────────────────────────────────────────────────────
/**
 * Fetch all escrow jobs.
 *
 * @returns List of jobs.
 * @throws If the request fails.
 */
export async function fetchJobs() {
  const { data } = await api.get<{ success: boolean; data: EscrowJob[] }>(
    "/api/jobs",
  );
  return data.data;
}

/**
 * Fetch a single escrow job by id.
 *
 * @param id - Job id.
 * @returns The job.
 * @throws If the request fails (including 404s for missing jobs).
 */
export async function fetchJob(id: string) {
  const { data } = await api.get<{ success: boolean; data: EscrowJob }>(
    `/api/jobs/${id}`,
  );
  return data.data;
}

/**
 * Mark job completed after on-chain release_escrow succeeds (stores release tx hash).
 *
 * @param jobId - Job id.
 * @param releaseTransactionHash - Hash of the on-chain release transaction.
 * @returns Updated job record.
 * @throws If the request fails or the backend rejects the update.
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
/**
 * Fetch updates for a project.
 *
 * @param projectId - Project id.
 * @returns List of updates.
 * @throws If the request fails.
 */
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
/**
 * Subscribe an email (and optionally a donor address) to a project's updates.
 *
 * @param payload - Subscription payload.
 * @returns Backend response including a success flag and message.
 * @throws If the request fails or validation is rejected by the backend.
 */
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

/**
 * Fetch the number of subscribers for a project.
 *
 * @param projectId - Project id.
 * @returns Subscriber count.
 * @throws If the request fails.
 */
export async function fetchSubscriberCount(projectId: string) {
  const { data } = await api.get<{ success: boolean; count: number }>(
    `/api/subscriptions/${projectId}/count`,
  );
  return data.count;
}

// ── Global Stats ─────────────────────────────────────────────────
export interface GlobalStats {
  totalXLMRaised: string;
  totalCO2OffsetKg: number;
  totalDonations: number;
  totalProjects: number;
  totalDonors: number;
}

function normalizeGlobalStats(stats: Partial<GlobalStats>): GlobalStats {
  return {
    totalXLMRaised: stats.totalXLMRaised || "0.0000000",
    totalCO2OffsetKg: stats.totalCO2OffsetKg || 0,
    totalDonations: stats.totalDonations || 0,
    totalProjects: stats.totalProjects || 0,
    totalDonors: stats.totalDonors || 0,
  };
}

/**
 * Fetch global platform statistics.
 *
 * @returns Global statistics object.
 * @throws If the request fails.
 */
export async function fetchGlobalStats(): Promise<GlobalStats> {
  const { data } = await api.get<
    GlobalStats | { success: boolean; data: GlobalStats }
  >("/api/stats/global");

  if ("data" in data && "success" in data) {
    return normalizeGlobalStats(data.data);
  }

  return normalizeGlobalStats(data);
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

// ── Notifications ─────────────────────────────────────────────────
export interface UnreadNotificationCountParams {
  token: string;
  lastSeen?: string;
}

export async function fetchUnreadNotificationCount({
  token,
  lastSeen,
}: UnreadNotificationCountParams): Promise<number> {
  const params: Record<string, string> = { token };
  if (lastSeen) params.lastSeen = lastSeen;

  const { data } = await api.get<{ unreadCount: number }>(
    "/api/notifications/unread-count",
    { params },
  );
  return data.unreadCount;
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
/**
 * Fetch the featured project, if one is configured by the backend.
 *
 * @returns The featured project, or `null` if none exists or the request fails.
 * @throws Never; backend errors are caught and converted to `null`.
 */
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

export interface AdminNotificationPayload {
  projectName: string;
  contactEmail: string;
  impactMetrics: string[];
}

export async function submitProject(payload: SubmitProjectPayload): Promise<SubmitProjectResponse> {
  const { data } = await api.post<{ success: boolean; data: SubmitProjectResponse }>(
    "/api/projects",
    payload,
  );
  return data.data;
}

// ── Verification Requests (/apply) ───────────────────────────────────────────
export interface VerificationDocument {
  name: string;
  url: string;
  size?: number;
  contentType?: string;
  backend?: "local" | "s3" | "ipfs";
}

export interface VerificationRequestPayload {
  organizationName: string;
  organizationWebsite?: string;
  organizationCountry?: string;
  contactEmail: string;
  walletAddress: string;
  projectName: string;
  projectCategory: string;
  projectLocation: string;
  projectDescription?: string;
  co2PerXLM: string;
  expectedAnnualTonnesCO2?: string;
  supportingDocuments?: VerificationDocument[];
  notes?: string;
}

export interface VerificationRequestResponse {
  id: string;
  organizationName: string;
  organizationWebsite: string | null;
  organizationCountry: string | null;
  contactEmail: string;
  walletAddress: string;
  projectName: string;
  projectCategory: string;
  projectLocation: string;
  projectDescription: string | null;
  co2PerXLM: string;
  expectedAnnualTonnesCO2: string | null;
  supportingDocuments: VerificationDocument[];
  storageBackend: "local" | "s3" | "ipfs";
  notes: string | null;
  status: "pending" | "in_review" | "approved" | "rejected";
  reviewerNotes: string | null;
  reviewedBy: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewTimeline: string;
}

export async function submitVerificationRequest(
  payload: VerificationRequestPayload,
): Promise<VerificationRequestResponse> {
  const { data } = await api.post<{ success: boolean; data: VerificationRequestResponse }>(
    "/api/verification-requests",
    payload,
  );
  return data.data;
}

export async function fetchMyVerificationRequests(
  walletAddress: string,
): Promise<VerificationRequestResponse[]> {
  const { data } = await api.get<{ success: boolean; data: VerificationRequestResponse[] }>(
    "/api/verification-requests/me",
    { params: { wallet: walletAddress } },
  );
  return data.data;
}

export async function fetchVerificationRequest(
  id: string,
  walletAddress?: string,
): Promise<VerificationRequestResponse> {
  const params: Record<string, string> = {};
  if (walletAddress) params.wallet = walletAddress;
  const { data } = await api.get<{ success: boolean; data: VerificationRequestResponse }>(
    `/api/verification-requests/${id}`,
    { params },
  );
  return data.data;
}

export interface UploadedDocument {
  key: string;
  url: string;
  size: number;
  contentType: string;
  backend: "local" | "s3" | "ipfs";
  originalName: string;
}

/**
 * Uploads a file to /api/uploads. The backend stores it according to
 * STORAGE_BACKEND (local disk by default) and returns a URL that the
 * verification form stashes into `supportingDocuments[]` on submit.
 */
export async function uploadSupportingDocument(file: File): Promise<UploadedDocument> {
  // CSRF + multipart: axios automatically sets the right Content-Type when
  // given a FormData body; we still need the X-CSRF-Token header, which the
  // request interceptor already adds on POSTs.
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<{ success: boolean; data: UploadedDocument }>(
    "/api/uploads",
    form,
  );
  return data.data;
}

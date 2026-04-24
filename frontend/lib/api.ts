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
});

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
  }>("/api/leaderboard", { params: { limit } });
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
  totalDonations: number;
  totalXLMRaised: string;
  totalCO2OffsetKg: number;
}

/**
 * Fetch global platform statistics.
 *
 * @returns Global statistics object.
 * @throws If the request fails.
 */
export async function fetchGlobalStats(): Promise<GlobalStats> {
  const { data } = await api.get<{ success: boolean; data: GlobalStats }>(
    "/api/stats/global",
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

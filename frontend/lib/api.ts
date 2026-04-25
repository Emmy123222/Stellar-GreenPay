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
});

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

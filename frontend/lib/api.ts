/**
 * -----------------------------------------------------------------------------
 * lib/api.ts — Backend HTTP Client
 * -----------------------------------------------------------------------------
 * This module provides a centralized HTTP client for interacting with the
 * backend API. It wraps Axios requests and exposes strongly-typed helper
 * functions for:
 *
 * - Climate projects
 * - Donations
 * - Donor profiles
 * - Leaderboard
 * - Project updates
 *
 * All functions return parsed response data and abstract away HTTP details.
 *
 * @see https://axios-http.com/docs/intro
 * @see https://developers.stellar.org/api/introduction (Horizon API reference)
 * -----------------------------------------------------------------------------
 */

import axios from "axios";
import type {
  ClimateProject,
  Donation,
  DonorProfile,
  ProjectUpdate,
  LeaderboardEntry,
} from "@/utils/types";

/**
 * Pre-configured Axios instance for backend communication.
 */
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

// ── Projects ──────────────────────────────────────────────────────────────────

/**
 * Fetch a list of climate projects with optional filters.
 *
 * @param params - Optional query filters
 * @param params.category - Filter by project category
 * @param params.status - Filter by project status
 * @param params.verified - Filter by verification status
 * @param params.limit - Maximum number of results
 *
 * @returns Promise resolving to an array of ClimateProject objects
 *
 * @throws Will throw an error if the network request fails
 *
 * @example
 * ```ts
 * const projects = await fetchProjects({ category: "reforestation", limit: 10 });
 * console.log(projects);
 * ```
 */
export async function fetchProjects(params?: {
  category?: string;
  status?: string;
  verified?: boolean;
  limit?: number;
}) {
  const { data } = await api.get<{
    success: boolean;
    data: ClimateProject[];
  }>("/api/projects", { params });

  return data.data;
}

/**
 * Fetch a single project by its ID.
 *
 * @param id - The unique project identifier
 *
 * @returns Promise resolving to a ClimateProject object
 *
 * @throws Will throw an error if the project is not found or request fails
 */
export async function fetchProject(id: string) {
  const { data } = await api.get<{
    success: boolean;
    data: ClimateProject;
  }>(`/api/projects/${id}`);

  return data.data;
}

// ── Donations ─────────────────────────────────────────────────────────────────

/**
 * Record a donation in the backend.
 *
 * @param payload - Donation details
 * @param payload.projectId - ID of the project being funded
 * @param payload.donorAddress - Stellar public key of the donor
 * @param payload.amountXLM - Amount donated in XLM
 * @param payload.message - Optional donor message
 * @param payload.transactionHash - Blockchain transaction hash
 *
 * @returns Promise resolving to the created Donation record
 *
 * @throws Will throw an error if submission fails or validation errors occur
 *
 * @example
 * ```ts
 * const donation = await recordDonation({
 *   projectId: "abc123",
 *   donorAddress: "GXXXX...",
 *   amountXLM: "50",
 *   transactionHash: "HASH123",
 *   message: "Keep up the great work!",
 * });
 * ```
 */
export async function recordDonation(payload: {
  projectId: string;
  donorAddress: string;
  amountXLM: string;
  message?: string;
  transactionHash: string;
}) {
  const { data } = await api.post<{
    success: boolean;
    data: Donation;
  }>("/api/donations", payload);

  return data.data;
}

/**
 * Fetch donations for a specific project with pagination.
 *
 * @param projectId - ID of the project
 * @param limit - Number of donations to fetch (default: 20)
 * @param cursor - Optional pagination cursor
 *
 * @returns Promise resolving to donations list and next cursor
 *
 * @throws Will throw an error if request fails
 */
export async function fetchProjectDonations(
  projectId: string,
  limit = 20,
  cursor?: string
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
 * Fetch donation history for a specific donor.
 *
 * @param publicKey - Stellar public key of the donor
 *
 * @returns Promise resolving to an array of Donation records
 *
 * @throws Will throw an error if request fails
 */
export async function fetchDonorHistory(publicKey: string) {
  const { data } = await api.get<{
    success: boolean;
    data: Donation[];
  }>(`/api/donations/donor/${publicKey}`);

  return data.data;
}

// ── Profiles ──────────────────────────────────────────────────────────────────

/**
 * Fetch a donor profile by public key.
 *
 * @param publicKey - Stellar public key
 *
 * @returns Promise resolving to a DonorProfile object
 *
 * @throws Will throw an error if request fails or profile is not found
 */
export async function fetchProfile(publicKey: string) {
  const { data } = await api.get<{
    success: boolean;
    data: DonorProfile;
  }>(`/api/profiles/${publicKey}`);

  return data.data;
}

/**
 * Create or update a donor profile.
 *
 * @param payload - Partial profile data with required publicKey
 *
 * @returns Promise resolving to the updated DonorProfile
 *
 * @throws Will throw an error if request fails
 */
export async function upsertProfile(
  payload: Partial<DonorProfile> & { publicKey: string }
) {
  const { data } = await api.post<{
    success: boolean;
    data: DonorProfile;
  }>("/api/profiles", payload);

  return data.data;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

/**
 * Fetch leaderboard rankings.
 *
 * @param limit - Number of top entries to fetch (default: 20)
 *
 * @returns Promise resolving to an array of LeaderboardEntry objects
 *
 * @throws Will throw an error if request fails
 */
export async function fetchLeaderboard(limit = 20) {
  const { data } = await api.get<{
    success: boolean;
    data: LeaderboardEntry[];
  }>("/api/leaderboard", { params: { limit } });

  return data.data;
}

// ── Project Updates ───────────────────────────────────────────────────────────

/**
 * Fetch updates for a specific project.
 *
 * @param projectId - ID of the project
 *
 * @returns Promise resolving to an array of ProjectUpdate objects
 *
 * @throws Will throw an error if request fails
 */
export async function fetchProjectUpdates(projectId: string) {
  const { data } = await api.get<{
    success: boolean;
    data: ProjectUpdate[];
  }>(`/api/updates/${projectId}`);

  return data.data;
}
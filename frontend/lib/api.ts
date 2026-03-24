/**
 * lib/api.ts — Backend HTTP client
 */
import axios from "axios";
import type { ClimateProject, Donation, DonorProfile, ProjectUpdate, LeaderboardEntry } from "@/utils/types";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

// ── Projects ──────────────────────────────────────────────────────────────────
export async function fetchProjects(params?: { category?: string; status?: string; verified?: boolean; limit?: number }) {
  const { data } = await api.get<{ success: boolean; data: ClimateProject[] }>("/api/projects", { params });
  return data.data;
}

export async function fetchProject(id: string) {
  const { data } = await api.get<{ success: boolean; data: ClimateProject }>(`/api/projects/${id}`);
  return data.data;
}

// ── Donations ─────────────────────────────────────────────────────────────────
export async function recordDonation(payload: {
  projectId: string; donorAddress: string; amountXLM: string;
  message?: string; transactionHash: string;
}) {
  const { data } = await api.post<{ success: boolean; data: Donation }>("/api/donations", payload);
  return data.data;
}

export async function fetchProjectDonations(projectId: string, limit = 20) {
  const { data } = await api.get<{ success: boolean; data: Donation[] }>(`/api/donations/project/${projectId}`, { params: { limit } });
  return data.data;
}

export async function fetchDonorHistory(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: Donation[] }>(`/api/donations/donor/${publicKey}`);
  return data.data;
}

// ── Profiles ──────────────────────────────────────────────────────────────────
export async function fetchProfile(publicKey: string) {
  const { data } = await api.get<{ success: boolean; data: DonorProfile }>(`/api/profiles/${publicKey}`);
  return data.data;
}

export async function upsertProfile(payload: Partial<DonorProfile> & { publicKey: string }) {
  const { data } = await api.post<{ success: boolean; data: DonorProfile }>("/api/profiles", payload);
  return data.data;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
export async function fetchLeaderboard(limit = 20) {
  const { data } = await api.get<{ success: boolean; data: LeaderboardEntry[] }>("/api/leaderboard", { params: { limit } });
  return data.data;
}

// ── Project Updates ───────────────────────────────────────────────────────────
export async function fetchProjectUpdates(projectId: string) {
  const { data } = await api.get<{ success: boolean; data: ProjectUpdate[] }>(`/api/updates/${projectId}`);
  return data.data;
}

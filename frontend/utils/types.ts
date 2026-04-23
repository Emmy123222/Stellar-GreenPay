/**
 * utils/types.ts
 * Shared TypeScript types for Stellar GreenPay.
 */

export type ProjectCategory =
  | "Reforestation"
  | "Solar Energy"
  | "Ocean Conservation"
  | "Clean Water"
  | "Wildlife Protection"
  | "Carbon Capture"
  | "Wind Energy"
  | "Sustainable Agriculture"
  | "Other";

export type ProjectStatus = "active" | "completed" | "paused";

export interface ClimateProject {
  id: string;
  name: string;
  description: string;
  category: ProjectCategory;
  location: string;
  imageUrl?: string;
  walletAddress: string;       // Stellar address that receives donations
  goalXLM: string;             // fundraising goal
  raisedXLM: string;           // total raised so far
  donorCount: number;
  co2OffsetKg: number;         // estimated CO2 offset in kg
  co2_per_xlm: number;         // CO2 offset per XLM donated
  status: ProjectStatus;
  verified: boolean;
  onChainVerified?: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Donation {
  id: string;
  projectId: string;
  donorAddress: string;
  // Amount as stored and the currency used (e.g. "XLM" or "USDC").
  amountXLM?: string;
  amount?: string;
  currency?: "XLM" | "USDC";
  message?: string;
  transactionHash: string;
  createdAt: string;
  // On-chain contract data
  contractRecordId?: string;
}

export interface DonorProfile {
  publicKey: string;
  displayName?: string;
  bio?: string;
  totalDonatedXLM: string;
  projectsSupported: number;
  badges: DonorBadge[];
  createdAt: string;
}

export type BadgeTier = "seedling" | "tree" | "forest" | "earth";

export interface FreelancerProfile {
  publicKey: string;
  displayName?: string;
  bio?: string;
  skills: string[];
  completedJobs: number;
  totalEarnedXLM: string;
  createdAt: string;
}

export interface DonorBadge {
  tier: BadgeTier;
  earnedAt: string;
  projectId?: string;
}

export interface ProjectUpdate {
  id: string;
  projectId: string;
  title: string;
  body: string;
  imageUrl?: string;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  publicKey: string;
  displayName?: string;
  totalDonatedXLM: string;
  projectsSupported: number;
  topBadge?: BadgeTier;
}

export interface DonateProject {
  id: string;
  name: string;
  description: string;
  category: ProjectCategory;
  walletAddress: string;
  goalXLM: number;
  raisedXLM: number;
}


export interface DonatePageProps {
  
  project: DonateProject | null;
  presetAmount: number | null;
}

export type EscrowJobStatus = "draft" | "in_escrow" | "completed";

export interface EscrowJob {
  id: string;
  title: string;
  description: string;
  clientPublicKey: string;
  freelancerPublicKey: string;
  amountEscrowXlm: string;
  status: EscrowJobStatus;
  releaseTransactionHash?: string | null;
  createdAt: string;
  updatedAt: string;
}
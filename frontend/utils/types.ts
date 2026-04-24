/**
 * utils/types.ts
 * Shared TypeScript types for Stellar GreenPay.
 */

/**
 * Supported project categories shown in the UI.
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

/**
 * Lifecycle status for a project in the marketplace.
 */
export type ProjectStatus = "active" | "completed" | "paused";

/**
 * A climate project listed on Stellar GreenPay.
 */
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
  contractRegisteredAt?: number | null;
  totalRaisedOnChain?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  campaigns?: ProjectCampaign[];
  activeCampaign?: ProjectCampaign | null;
  averageRating?: number;
  ratingCount?: number;
  milestones?: ProjectMilestone[];
}

/**
 * A project milestone representing progress towards a goal.
 */
export interface ProjectMilestone {
  id: string;
  projectId: string;
  percentage: number;
  title: string;
  reachedAt?: string | null;
  transactionHash?: string | null;
  createdAt: string;
}

/**
 * A time-limited fundraising campaign for a project.
 */
export interface ProjectCampaign {
  id: string;
  projectId: string;
  title: string;
  description: string;
  goalXLM: string;
  raisedXLM: string;
  deadline: string;
  progressPercent: number;
  completed: boolean;
  active: boolean;
  createdAt: string;
}

/**
 * A donation record associated with a project and donor.
 */
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

/**
 * Donor profile information stored off-chain.
 */
export interface DonorProfile {
  publicKey: string;
  displayName?: string;
  bio?: string;
  totalDonatedXLM: string;
  projectsSupported: number;
  badges: DonorBadge[];
  createdAt: string;
}

/**
 * Badge tiers awarded to donors based on total donations.
 */
export type BadgeTier = "seedling" | "tree" | "forest" | "earth";

/**
 * Freelancer profile used in the escrow/jobs feature.
 */
export interface FreelancerProfile {
  publicKey: string;
  displayName?: string;
  bio?: string;
  skills: string[];
  completedJobs: number;
  totalEarnedXLM: string;
  createdAt: string;
}

/**
 * A donor badge earned at a point in time.
 */
export interface DonorBadge {
  tier: BadgeTier;
  earnedAt: string;
  projectId?: string;
}

/**
 * Project update post displayed in the updates feed.
 */
export interface ProjectUpdate {
  id: string;
  projectId: string;
  title: string;
  body: string;
  imageUrl?: string;
  createdAt: string;
}

/**
 * Leaderboard entry representing a donor's rank and totals.
 */
export interface LeaderboardEntry {
  rank: number;
  publicKey: string;
  displayName?: string;
  totalDonatedXLM: string;
  projectsSupported: number;
  topBadge?: BadgeTier;
}

/**
 * Minimal project payload used by the donate page.
 */
export interface DonateProject {
  id: string;
  name: string;
  description: string;
  category: ProjectCategory;
  walletAddress: string;
  goalXLM: number;
  raisedXLM: number;
}

/**
 * Props provided to the donate page.
 */
export interface DonatePageProps {
  
  project: DonateProject | null;
  presetAmount: number | null;
}

/**
 * Status for an escrow job in the jobs marketplace.
 */
export type EscrowJobStatus = "draft" | "in_escrow" | "completed";

/**
 * Escrow job funded on-chain and tracked off-chain.
 */
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

/**
 * History entry for monthly subscription payments.
 */
export interface MonthlyDonationHistoryItem {
  paidAt: string;
  amountXLM: string;
}

/**
 * Recurring monthly donation subscription state.
 */
export interface MonthlySubscription {
  id: string;
  projectId: string;
  projectName: string;
  amountXLM: string;
  startDate: string;
  durationMonths: number | null;
  nextDueDate: string;
  remainingMonths: number | null;
  status: "active" | "completed";
  createdAt: string;
  history: MonthlyDonationHistoryItem[];
}

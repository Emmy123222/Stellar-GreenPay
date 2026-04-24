/**
 * utils/format.ts
 * Formatting helpers and small UI-friendly utilities shared across the frontend.
 */
import { formatDistanceToNow, format } from "date-fns";
import type { ProjectStatus, BadgeTier } from "./types";

/**
 * Format an amount as XLM with locale separators.
 *
 * @param amount - Amount in XLM (string or number).
 * @param decimals - Maximum fractional digits to show.
 * @returns Formatted string like `"1,234.56 XLM"`.
 * @throws {Error} Never throws; returns `"0 XLM"` for invalid input.
 *
 * @example
 * formatXLM(12.3456) // "12.35 XLM"
 * @example
 * formatXLM("1000", 0) // "1,000 XLM"
 */
export function formatXLM(amount: string | number, decimals = 2): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "0 XLM";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: decimals })} XLM`;
}

/**
 * Convert an XLM amount into an approximate USD string.
 *
 * @param xlmAmount - Amount in XLM.
 * @param price - Current XLM→USD price; when `null`, no estimate is returned.
 * @returns A string like `"≈ $12.34 USD"` or `null` if not available.
 * @throws {Error} Never throws; returns `null` for invalid inputs.
 */
export function formatUSDEquivalent(xlmAmount: string | number, price: number | null): string | null {
  if (price === null) return null;
  const n = typeof xlmAmount === "string" ? parseFloat(xlmAmount) : xlmAmount;
  if (isNaN(n)) return null;
  const usd = n * price;
  return `≈ $${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

/**
 * Format a CO₂ amount (in kilograms) into a compact human-readable string.
 *
 * @param kg - CO₂ offset in kilograms.
 * @returns A string like `"850 kg CO₂"`, `"1.2k kg CO₂"`, or `"3.4M kg CO₂"`.
 * @throws {Error} Never throws.
 *
 * @example
 * formatCO2(850) // "850 kg CO₂"
 * @example
 * formatCO2(1200) // "1.2k kg CO₂"
 */
export function formatCO2(kg: number): string {
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(1)}M kg CO₂`;
  if (kg >= 1_000) return `${(kg / 1_000).toFixed(1)}k kg CO₂`;
  return `${kg.toLocaleString()} kg CO₂`;
}

/**
 * Calculate fundraising progress percent.
 *
 * @param raised - Raised XLM amount (string).
 * @param goal - Goal XLM amount (string).
 * @returns Integer percent between 0 and 100.
 * @throws {Error} Never throws; returns `0` when inputs are invalid.
 *
 * @example
 * progressPercent("50", "200") // 25
 * @example
 * progressPercent("9999", "100") // 100
 */
export function progressPercent(raised: string, goal: string): number {
  const r = parseFloat(raised), g = parseFloat(goal);
  if (!g || isNaN(r) || isNaN(g)) return 0;
  return Math.min(100, Math.round((r / g) * 100));
}

/**
 * Convert an ISO date string to a relative time (e.g. "3 days ago").
 *
 * @param d - ISO date string.
 * @returns Relative time string, or the original input on failure.
 * @throws {Error} Never throws.
 */
export function timeAgo(d: string): string {
  try { return formatDistanceToNow(new Date(d), { addSuffix: true }); }
  catch { return d; }
}

/**
 * Format an ISO date string as "MMM d, yyyy".
 *
 * @param d - ISO date string.
 * @returns Formatted date string, or the original input on failure.
 * @throws {Error} Never throws.
 */
export function formatDate(d: string): string {
  try { return format(new Date(d), "MMM d, yyyy"); }
  catch { return d; }
}

/**
 * Shorten a Stellar address to `prefix...suffix`.
 *
 * @param address - Full address string.
 * @param chars - Number of characters to keep at both ends.
 * @returns Shortened address.
 * @throws {Error} Never throws.
 */
export function shortenAddress(address: string, chars = 6): string {
  if (!address || address.length < chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Copy a string to the user's clipboard.
 *
 * @param text - Text to copy.
 * @returns `true` on success, `false` on failure.
 * @throws {Error} Never throws; errors are caught and return `false`.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

/**
 * Map a project status to a CSS class used by status badges.
 *
 * @param s - Project status.
 * @returns Tailwind/CSS class name.
 * @throws {Error} Never throws.
 */
export function statusClass(s: ProjectStatus): string {
  return { active: "badge-active", completed: "badge-complete", paused: "badge-paused" }[s];
}

/**
 * Map a project status to a human-readable label.
 *
 * @param s - Project status.
 * @returns Label string.
 * @throws {Error} Never throws.
 */
export function statusLabel(s: ProjectStatus): string {
  return { active: "Active", completed: "Completed", paused: "Paused" }[s];
}

/**
 * Map a badge tier to its emoji representation.
 *
 * @param tier - Badge tier.
 * @returns Emoji string.
 * @throws {Error} Never throws.
 *
 * @example
 * badgeEmoji("seedling") // "🌱"
 * @example
 * badgeEmoji("earth") // "🌍"
 */
export function badgeEmoji(tier: BadgeTier): string {
  return { seedling: "🌱", tree: "🌳", forest: "🌲", earth: "🌍" }[tier];
}

/**
 * Map a badge tier to a display label.
 *
 * @param tier - Badge tier.
 * @returns Label string.
 * @throws {Error} Never throws.
 */
export function badgeLabel(tier: BadgeTier): string {
  return { seedling: "Seedling", tree: "Tree", forest: "Forest", earth: "Earth Guardian" }[tier];
}

/**
 * Minimum donation threshold (in XLM) for a badge tier.
 *
 * @param tier - Badge tier.
 * @returns Threshold in XLM.
 * @throws {Error} Never throws.
 */
export function badgeThreshold(tier: BadgeTier): number {
  return { seedling: 10, tree: 100, forest: 500, earth: 2000 }[tier];
}

/**
 * List of known project categories used by the UI.
 *
 * @returns An array of category names.
 * @throws {Error} Never throws.
 */
export const PROJECT_CATEGORIES = [
  "Reforestation", "Solar Energy", "Ocean Conservation", "Clean Water",
  "Wildlife Protection", "Carbon Capture", "Wind Energy",
  "Sustainable Agriculture", "Other",
];

/**
 * Mapping from category name to an emoji icon used in the UI.
 *
 * @returns Record of category to emoji.
 * @throws {Error} Never throws.
 */
export const CATEGORY_ICONS: Record<string, string> = {
  "Reforestation": "🌳",
  "Solar Energy": "☀️",
  "Ocean Conservation": "🌊",
  "Clean Water": "💧",
  "Wildlife Protection": "🦁",
  "Carbon Capture": "♻️",
  "Wind Energy": "💨",
  "Sustainable Agriculture": "🌾",
  "Other": "🌿",
};

/**
 * Calculate a donor's monthly donation streak.
 *
 * @param donations - Donations with `createdAt` timestamps.
 * @returns Current streak and longest streak (in months).
 * @throws {Error} Never throws.
 */
export function calculateStreak(donations: { createdAt: string }[]): { current: number; longest: number } {
  if (donations.length === 0) return { current: 0, longest: 0 };

  // Group by month (YYYY-MM)
  const months = Array.from(new Set(donations.map(d => {
    const date = new Date(d.createdAt);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }))).sort().reverse(); // Newest first

  if (months.length === 0) return { current: 0, longest: 0 };

  let currentStreak = 0;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStr = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  // Check if donor donated this month or last month to maintain current streak
  if (months[0] === currentMonth || months[0] === lastMonthStr) {
    let checkDate = new Date(now.getFullYear(), now.getMonth(), 1);
    if (months[0] !== currentMonth) {
       checkDate.setMonth(checkDate.getMonth() - 1);
    }
    
    for (let i = 0; i < months.length; i++) {
      const mStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}`;
      if (months.includes(mStr)) {
        currentStreak++;
        checkDate.setMonth(checkDate.getMonth() - 1);
      } else {
        break;
      }
    }
  }

  // Calculate longest streak
  let longest = 0;
  let tempStreak = 0;
  const allMonths = [...months].reverse(); // Oldest first
  
  for (let i = 0; i < allMonths.length; i++) {
    if (i === 0) {
      tempStreak = 1;
    } else {
      const prevDate = new Date(allMonths[i-1] + '-01');
      const currDate = new Date(allMonths[i] + '-01');
      const diff = (currDate.getFullYear() - prevDate.getFullYear()) * 12 + (currDate.getMonth() - prevDate.getMonth());
      
      if (diff === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
    }
    longest = Math.max(longest, tempStreak);
  }

  return { current: currentStreak, longest };
}

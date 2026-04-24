/**
 * utils/format.ts
 */
import { formatDistanceToNow, format } from "date-fns";
import type { ProjectStatus, BadgeTier } from "./types";

export function formatXLM(amount: string | number, decimals = 2): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "0 XLM";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: decimals })} XLM`;
}

export function formatUSDEquivalent(xlmAmount: string | number, price: number | null): string | null {
  if (price === null) return null;
  const n = typeof xlmAmount === "string" ? parseFloat(xlmAmount) : xlmAmount;
  if (isNaN(n)) return null;
  const usd = n * price;
  return `≈ $${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

export function formatCO2(kg: number): string {
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(1)}M kg CO₂`;
  if (kg >= 1_000) return `${(kg / 1_000).toFixed(1)}k kg CO₂`;
  return `${kg.toLocaleString()} kg CO₂`;
}

export function progressPercent(raised: string, goal: string): number {
  const r = parseFloat(raised), g = parseFloat(goal);
  if (!g || isNaN(r) || isNaN(g)) return 0;
  return Math.min(100, Math.round((r / g) * 100));
}

export function timeAgo(d: string): string {
  try { return formatDistanceToNow(new Date(d), { addSuffix: true }); }
  catch { return d; }
}

export function formatDate(d: string): string {
  try { return format(new Date(d), "MMM d, yyyy"); }
  catch { return d; }
}

export function shortenAddress(address: string, chars = 6): string {
  if (!address || address.length < chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

export function statusClass(s: ProjectStatus): string {
  return { active: "badge-active", completed: "badge-complete", paused: "badge-paused" }[s];
}

export function statusLabel(s: ProjectStatus): string {
  return { active: "Active", completed: "Completed", paused: "Paused" }[s];
}

export function badgeEmoji(tier: BadgeTier): string {
  return { seedling: "🌱", tree: "🌳", forest: "🌲", earth: "🌍" }[tier];
}

export function badgeLabel(tier: BadgeTier): string {
  return { seedling: "Seedling", tree: "Tree", forest: "Forest", earth: "Earth Guardian" }[tier];
}

export function badgeThreshold(tier: BadgeTier): number {
  return { seedling: 10, tree: 100, forest: 500, earth: 2000 }[tier];
}

export const PROJECT_CATEGORIES = [
  "Reforestation", "Solar Energy", "Ocean Conservation", "Clean Water",
  "Wildlife Protection", "Carbon Capture", "Wind Energy",
  "Sustainable Agriculture", "Other",
];

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

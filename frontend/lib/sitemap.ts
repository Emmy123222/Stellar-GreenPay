// Sitemap generation helpers (used by pages/sitemap.xml.tsx).

export const SITEMAP_STATIC_ROUTES = [
  "/",
  "/projects",
  "/map",
  "/leaderboard",
  "/impact",
  "/governance",
  "/compare",
  "/contributors",
  "/jobs",
  "/bridge",
  "/submit-project",
  "/api-docs",
] as const;

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildSitemapXml(appUrl: string, projectIds: string[]): string {
  const base = appUrl.replace(/\/+$/, "");
  const paths = [
    ...SITEMAP_STATIC_ROUTES,
    ...projectIds.map((id) => `/projects/${encodeURIComponent(id)}`),
  ];
  const urls = paths
    .map((path) => `  <url><loc>${escapeXml(base + (path === "/" ? "" : path))}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Collect ids of all active projects from the backend, following cursor
 * pagination. Failures degrade to whatever was collected so far, so the
 * sitemap still serves the static routes if the API is down.
 */
export async function fetchProjectIds(apiUrl: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) query.set("cursor", cursor);
      const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/v1/projects?${query}`);
      if (!res.ok) break;
      const body = (await res.json()) as {
        data?: { id: string }[];
        next_cursor?: string | null;
      };
      for (const project of body.data ?? []) ids.push(project.id);
      cursor = body.next_cursor ?? null;
      if (!cursor) break;
    }
  } catch {
    // Backend unreachable: fall through with what we have.
  }
  return ids;
}

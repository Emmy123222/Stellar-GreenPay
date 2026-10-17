import type { GetServerSideProps } from "next";
import { buildSitemapXml, fetchProjectIds } from "@/lib/sitemap";

// Rendered entirely in getServerSideProps; the component is never mounted.
export default function Sitemap() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://stellar-greenpay.app";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const xml = buildSitemapXml(appUrl, await fetchProjectIds(apiUrl));

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.write(xml);
  res.end();
  return { props: {} };
};

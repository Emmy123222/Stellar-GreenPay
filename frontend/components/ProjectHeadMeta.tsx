import React from "react";
import Head from "next/head";
import type { ClimateProject } from "@/utils/types";

export interface ProjectHeadMetaProps {
  project: ClimateProject;
  ogProject?: {
    id?: string;
    name: string;
    description: string;
    imageUrl?: string;
    category: string;
    location: string;
  } | null;
}

export default function ProjectHeadMeta({ project, ogProject }: ProjectHeadMetaProps) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://stellar-greenpay.app";
  const ogTitle = ogProject ? `${ogProject.name} — Stellar GreenPay` : "Stellar GreenPay";
  const ogDescription = ogProject
    ? `${ogProject.description.slice(0, 160).trimEnd()}… Support this ${ogProject.category} project on Stellar GreenPay.`
    : "Donate XLM directly to verified climate projects on Stellar.";
  const ogImage = ogProject?.id
    ? `${appUrl}/api/og?id=${ogProject.id}`
    : ogProject?.imageUrl || `${appUrl}/og-default.png`;

  return (
    <Head>
      <title>{ogTitle}</title>
      <meta name="greenpay:project:id" content={project.id} />
      <meta name="description" content={ogDescription} />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={ogTitle} />
      <meta property="og:description" content={ogDescription} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={ogTitle} />
      <meta name="twitter:description" content={ogDescription} />
      <meta name="twitter:image" content={ogImage} />
    </Head>
  );
}

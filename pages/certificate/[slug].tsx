import Head from "next/head";
import { useRouter } from "next/router";
import type { GetServerSideProps } from "next";

export interface CertificateData {
  slug: string;
  donorAddress: string;
  donorName: string;
  totalDonatedXLM: string;
  co2OffsetKg: number;
  badgeTier: string;
  projectsSupported: Array<{ name?: string }>;
  createdAt: string;
}

interface CertificatePageProps {
  certificate: CertificateData | null;
  shareUrl: string;
}

const SITE_NAME = "Stellar GreenPay";

function truncateAddress(address: string): string {
  if (!address || address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function buildShareText(cert: CertificateData): string {
  return `I've offset ${cert.co2OffsetKg} kg of CO2 and donated ${cert.totalDonatedXLM} XLM to climate projects on ${SITE_NAME}! 🌱`;
}

export default function CertificatePage({ certificate, shareUrl }: CertificatePageProps) {
  const router = useRouter();

  if (router.isFallback || !certificate) {
    return (
      <main style={{ padding: "4rem 1rem", textAlign: "center" }}>
        <h1>Certificate not found</h1>
        <p>This impact certificate does not exist or has been removed.</p>
      </main>
    );
  }

  const shareText = buildShareText(certificate);
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    shareText,
  )}&url=${encodeURIComponent(shareUrl)}`;
  const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(
    shareUrl,
  )}`;

  const title = `${certificate.donorName}'s Impact Certificate | ${SITE_NAME}`;
  const description = `${certificate.donorName} has offset ${certificate.co2OffsetKg} kg of CO2 and donated ${certificate.totalDonatedXLM} XLM to climate projects on ${SITE_NAME}.`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={shareUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={shareUrl} />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "CreativeWork",
              name: title,
              description,
              url: shareUrl,
              creator: { "@type": "Organization", name: SITE_NAME },
              dateCreated: certificate.createdAt,
            }),
          }}
        />
      </Head>

      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "3rem 1.5rem",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          color: "#0f172a",
        }}
      >
        <article
          style={{
            border: "1px solid #d1fae5",
            borderRadius: 16,
            padding: "2.5rem",
            background: "linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)",
            boxShadow: "0 10px 30px rgba(16, 185, 129, 0.08)",
          }}
        >
          <p style={{ letterSpacing: 2, textTransform: "uppercase", color: "#059669", margin: 0 }}>
            {SITE_NAME}
          </p>
          <h1 style={{ fontSize: "2rem", margin: "0.5rem 0 0.25rem" }}>Impact Certificate</h1>
          <p style={{ color: "#475569", marginTop: 0 }}>
            This certificate recognizes climate impact achieved through on-chain donations.
          </p>

          <h2 style={{ marginTop: "2rem", marginBottom: 0 }}>{certificate.donorName}</h2>
          <p style={{ color: "#64748b", marginTop: 4 }}>
            {truncateAddress(certificate.donorAddress)}
          </p>

          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "1rem",
              marginTop: "2rem",
            }}
          >
            <div>
              <dt style={{ color: "#64748b", fontSize: "0.85rem" }}>Total donated</dt>
              <dd style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
                {certificate.totalDonatedXLM} XLM
              </dd>
            </div>
            <div>
              <dt style={{ color: "#64748b", fontSize: "0.85rem" }}>CO2 offset</dt>
              <dd style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
                {certificate.co2OffsetKg} kg
              </dd>
            </div>
            <div>
              <dt style={{ color: "#64748b", fontSize: "0.85rem" }}>Badge tier</dt>
              <dd style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
                {certificate.badgeTier}
              </dd>
            </div>
            <div>
              <dt style={{ color: "#64748b", fontSize: "0.85rem" }}>Projects supported</dt>
              <dd style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
                {certificate.projectsSupported.length}
              </dd>
            </div>
          </dl>

          {certificate.projectsSupported.length > 0 && (
            <ul style={{ marginTop: "1.5rem", color: "#334155" }}>
              {certificate.projectsSupported.slice(0, 12).map((project, index) => (
                <li key={`${project.name || "project"}-${index}`}>
                  {project.name || "Project"}
                </li>
              ))}
            </ul>
          )}

          <p style={{ marginTop: "2rem", fontSize: "0.85rem", color: "#64748b" }}>
            Issued on {new Date(certificate.createdAt).toISOString().slice(0, 10)} · Verified by
            on-chain donation history
          </p>
        </article>

        <section style={{ marginTop: "2rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a
            href={twitterUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "0.75rem 1.25rem",
              borderRadius: 999,
              background: "#0f172a",
              color: "#ffffff",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Share on Twitter
          </a>
          <a
            href={linkedInUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "0.75rem 1.25rem",
              borderRadius: 999,
              background: "#0a66c2",
              color: "#ffffff",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Share on LinkedIn
          </a>
        </section>
      </main>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<CertificatePageProps> = async (ctx) => {
  const slug = ctx.params?.slug;
  if (typeof slug !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(slug)) {
    return { notFound: true };
  }

  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_URL ||
    "http://localhost:4000";

  const host = ctx.req.headers.host || "greenpay.io";
  const proto = (ctx.req.headers["x-forwarded-proto"] as string) || "https";
  const shareUrl = `${proto}://${host}/certificate/${slug}`;

  try {
    const response = await fetch(`${apiBase}/api/impact/certificate/${encodeURIComponent(slug)}`);
    if (!response.ok) {
      return { notFound: true };
    }
    const payload = (await response.json()) as { success: boolean; data: CertificateData };
    if (!payload?.success || !payload.data) {
      return { notFound: true };
    }
    return {
      props: {
        certificate: payload.data,
        shareUrl,
      },
    };
  } catch (error) {
    return { notFound: true };
  }
};
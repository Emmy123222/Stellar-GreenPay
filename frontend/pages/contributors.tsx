/**
 * pages/contributors.tsx — Contributor attribution timeline
 * Celebrates merged pull requests and the people behind them.
 */
import Head from "next/head";
import type { GetStaticProps } from "next";
import ContributorTimeline from "@/components/ContributorTimeline";
import { fetchMergedPullRequests } from "@/lib/github";
import type { ContributorPR } from "@/utils/types";

interface ContributorsPageProps {
  pullRequests: ContributorPR[];
}

export default function ContributorsPage({ pullRequests }: ContributorsPageProps) {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <Head>
        <title>Contributors | Stellar GreenPay</title>
        <meta
          name="description"
          content="Meet the contributors shipping features for Stellar GreenPay, one merged pull request at a time."
        />
      </Head>

      <div className="text-center mb-10">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-forest-900 mb-3">
          Contributors
        </h1>
        <p className="text-[#5a7a5a] dark:text-[#8aaa8a] max-w-xl mx-auto font-body leading-relaxed">
          Every feature on Stellar GreenPay was shipped by someone in the open-source
          community. Here&apos;s a timeline of merged pull requests and the people behind them.
        </p>
      </div>

      <ContributorTimeline pullRequests={pullRequests} />

      <div className="mt-10 text-center">
        <p className="text-[#5a7a5a] dark:text-[#8aaa8a] text-sm font-body">
          Want to see your name here?{" "}
          <a
            href="https://github.com/Emmy123222/Stellar-GreenPay"
            target="_blank"
            rel="noopener noreferrer"
            className="text-forest-600 underline"
          >
            Open a pull request
          </a>
          .
        </p>
      </div>
    </div>
  );
}

export const getStaticProps: GetStaticProps<ContributorsPageProps> = async () => {
  try {
    const pullRequests = await fetchMergedPullRequests(20);
    return {
      props: { pullRequests },
      revalidate: 3600,
    };
  } catch (err) {
    console.error("Failed to fetch merged pull requests:", err);
    return {
      props: { pullRequests: [] },
      revalidate: 300,
    };
  }
};

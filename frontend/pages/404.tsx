import Head from "next/head";
import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <Head>
        <title>404 — Page Not Found | GreenPay</title>
      </Head>

      <div className="min-h-screen bg-leaf flex flex-col items-center justify-center px-4 py-16">
        {/* Leaf visual */}
        <div className="text-8xl mb-6 select-none">🌿</div>

        {/* Heading */}
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-gradient-green text-center mb-4">
          404
        </h1>

        {/* Nature-themed message */}
        <p className="font-body text-lg sm:text-xl text-[#1a2e1a] font-medium text-center mb-2">
          This page has gone back to nature 🌿
        </p>
        <p className="font-body text-sm text-[#5a7a5a] dark:text-[#8aaa8a] text-center mb-10 max-w-sm">
          The path you followed has returned to the forest floor. Let&apos;s get
          you back to greener ground.
        </p>

        {/* Navigation buttons */}
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs sm:max-w-none sm:w-auto">
          <Link href="/projects" className="btn-primary text-center">
            Browse Projects
          </Link>
          <Link href="/" className="btn-secondary text-center">
            Go Home
          </Link>
        </div>

        {/* Subtle decorative footer */}
        <p className="mt-16 text-xs text-[#5a7a5a] dark:text-[#8aaa8a] font-body">
          🌱 GreenPay — every donation tracked on-chain
        </p>
      </div>
    </>
  );
}
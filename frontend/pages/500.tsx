import Head from "next/head";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";

export default function ServerError() {
  const { t } = useI18n();

  return (
    <>
      <Head>
        <title>500 — {t("common.serverErrorTitle")} | GreenPay</title>
      </Head>

      <main className="min-h-screen bg-leaf flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="text-8xl mb-6 select-none" aria-hidden="true">🌿</div>
        <p className="font-display text-4xl sm:text-5xl font-semibold text-gradient-green mb-4" aria-hidden="true">500</p>
        <h1 className="font-body text-lg sm:text-xl text-[#1a2e1a] dark:text-[#d5e8d5] font-medium mb-2">
          {t("common.serverErrorTitle")}
        </h1>
        <p className="font-body text-sm text-[var(--text-secondary)] dark:text-[#8aaa8a] mb-10 max-w-sm">
          {t("common.serverErrorDescription")}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs sm:max-w-none sm:w-auto">
          <button type="button" onClick={() => window.location.reload()} className="btn-primary">
            {t("common.retry")}
          </button>
          <Link href="/" className="btn-secondary text-center">
            {t("common.backToHome")}
          </Link>
        </div>
      </main>
    </>
  );
}

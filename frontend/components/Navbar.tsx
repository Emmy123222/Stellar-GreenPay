/**
 * components/Navbar.tsx
 */
import Link from "next/link";
import { useRouter } from "next/router";
import { shortenAddress } from "@/utils/format";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/themeContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import clsx from "clsx";

interface NavbarProps { publicKey: string | null; onConnect: () => void; onDisconnect: () => void; }

export default function Navbar({ publicKey, onConnect, onDisconnect }: NavbarProps) {
  const router = useRouter();
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const network = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet").toLowerCase();
  const isMainnet = network === "mainnet";

  const links = [
    { href: "/",            label: t("nav.home") },
    { href: "/projects",    label: t("nav.projects") },
    { href: "/jobs",        label: t("nav.jobs") },
    { href: "/bridge",      label: t("nav.bridge") },
    { href: "/impact",      label: t("nav.impact") },
    { href: "/leaderboard", label: t("nav.leaderboard") },
    { href: "/dashboard",   label: t("nav.myImpact") },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-[rgba(34,114,57,0.12)] shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-forest-100 border border-forest-200 flex items-center justify-center group-hover:border-forest-400 transition-colors">
              <span className="text-base">🌱</span>
            </div>
            <span className="font-display font-bold text-forest-900 text-lg tracking-tight">
              Stellar<span className="text-forest-500">GreenPay</span>
            </span>
          </Link>

          <span className={`hidden md:inline-flex ${isMainnet ? "badge-verified" : "badge-paused"}`}>
            {isMainnet ? t("nav.mainnet") : t("nav.testnet")}
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={clsx(
                "px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 font-body",
                router.pathname === l.href || router.pathname.startsWith(l.href + "/") && l.href !== "/"
                  ? "bg-forest-100 text-forest-700"
                  : "text-[#5a7a5a] dark:text-[#8aaa8a] hover:text-forest-700 hover:bg-forest-50"
              )}>
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#5a7a5a] dark:text-[#8aaa8a] hover:text-forest-700 hover:bg-forest-50 transition-colors"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z" clipRule="evenodd" />
              </svg>
            )}
          </button>
          <LanguageSwitcher />
          {publicKey ? (
            <>
              <span className="address-tag flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {shortenAddress(publicKey)}
              </span>
              <button onClick={onDisconnect} className="text-xs text-[#8aaa8a] dark:text-forest-300 hover:text-[#5a7a5a] dark:hover:text-[#8aaa8a] transition-colors px-2">
                {t("nav.disconnect")}
              </button>
            </>
          ) : (
            <button onClick={onConnect} className="btn-primary text-sm py-2 px-4">
              {t("nav.connectWallet")}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

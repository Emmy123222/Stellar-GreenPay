/**
 * components/Navbar.tsx
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { fetchUnreadNotificationCount } from "@/lib/api";
import { shortenAddress } from "@/utils/format";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/themeContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import clsx from "clsx";

interface NavbarProps {
  publicKey: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export default function Navbar({ publicKey, onConnect, onDisconnect }: NavbarProps) {
  const router = useRouter();
  const { t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const network = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet").toLowerCase();
  const isMainnet = network === "mainnet";
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const token = typeof window !== "undefined"
      ? window.localStorage.getItem("greenpay:deviceToken")
      : null;
    const lastSeen = typeof window !== "undefined"
      ? window.localStorage.getItem("greenpay:notifications:lastSeen") || undefined
      : undefined;

    if (!token) {
      setUnreadCount(0);
      return;
    }

    let cancelled = false;
    fetchUnreadNotificationCount({ token, lastSeen })
      .then((count) => {
        if (!cancelled) setUnreadCount(count);
      })
      .catch(() => {
        if (!cancelled) setUnreadCount(0);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const links = [
    { href: "/",            label: t("nav.home") },
    { href: "/projects",    label: t("nav.projects") },
    { href: "/map",         label: t("nav.map") },
    { href: "/jobs",        label: t("nav.jobs") },
    { href: "/bridge",      label: t("nav.bridge") },
    { href: "/impact",      label: t("nav.impact") },
    { href: "/leaderboard", label: t("nav.leaderboard") },
    { href: "/dashboard",   label: t("nav.myImpact") },
    { href: "/apply",       label: t("nav.apply") },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-white/90 dark:bg-[#0e1f13]/95 backdrop-blur-xl border-b border-[rgba(34,114,57,0.12)] dark:border-[rgba(96,208,123,0.18)] shadow-sm dark:shadow-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-forest-100 dark:bg-[#1c3928] border border-forest-200 dark:border-[rgba(96,208,123,0.25)] flex items-center justify-center group-hover:border-forest-400 dark:group-hover:border-[rgba(96,208,123,0.45)] transition-colors">
              <span className="text-base">🌱</span>
            </div>
            <span className="font-display font-bold text-forest-900 dark:text-[#e6f5e9] text-lg tracking-tight">
              Stellar<span className="text-forest-500 dark:text-[#60d07b]">GreenPay</span>
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
                router.pathname === l.href || (router.pathname.startsWith(l.href + "/") && l.href !== "/")
                  ? "bg-forest-100 dark:bg-[#1c3928] text-forest-700 dark:text-[#81c784]"
                  : "text-[#5a7a5a] dark:text-[#b2d5b5] hover:text-forest-700 dark:hover:text-[#81c784] hover:bg-forest-50 dark:hover:bg-[rgba(96,208,123,0.10)]"
              )}>
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
          {unreadCount > 0 && (
            <span
              aria-label={`${unreadCount} unread notifications`}
              className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center shadow-sm"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
          {publicKey ? (
            <>
              <span className="address-tag flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {shortenAddress(publicKey)}
              </span>
              <button
                onClick={onDisconnect}
                className="text-xs text-[#8aaa8a] dark:text-[#7a9b80] hover:text-[#5a7a5a] dark:hover:text-[#b2d5b5] transition-colors px-2"
              >
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

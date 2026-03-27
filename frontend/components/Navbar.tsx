/**
 * components/Navbar.tsx
 */
import Link from "next/link";
import { useRouter } from "next/router";
import { shortenAddress } from "@/utils/format";
import clsx from "clsx";

interface NavbarProps { publicKey: string | null; onConnect: () => void; onDisconnect: () => void; }

const links = [
  { href: "/",            label: "Home" },
  { href: "/projects",    label: "Projects" },
  { href: "/impact",      label: "Impact" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/dashboard",   label: "My Impact" },
];

export default function Navbar({ publicKey, onConnect, onDisconnect }: NavbarProps) {
  const router = useRouter();
  const network = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet").toLowerCase();
  const isMainnet = network === "mainnet";

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
            {isMainnet ? "Mainnet" : "Testnet"}
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={clsx(
                "px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 font-body",
                router.pathname === l.href || router.pathname.startsWith(l.href + "/") && l.href !== "/"
                  ? "bg-forest-100 text-forest-700"
                  : "text-[#5a7a5a] hover:text-forest-700 hover:bg-forest-50"
              )}>
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {publicKey ? (
            <>
              <span className="address-tag flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {shortenAddress(publicKey)}
              </span>
              <button onClick={onDisconnect} className="text-xs text-[#8aaa8a] hover:text-[#5a7a5a] transition-colors px-2">
                Disconnect
              </button>
            </>
          ) : (
            <button onClick={onConnect} className="btn-primary text-sm py-2 px-4">
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

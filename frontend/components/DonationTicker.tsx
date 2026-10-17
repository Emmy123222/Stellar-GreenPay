/**
 * components/DonationTicker.tsx
 * Real-time donation ticker using Horizon SSE.
 *
 * Screen Reader Accessibility:
 * - This ticker constantly streams and cycles rapid donation activities.
 * - To prevent continuous stream of announcements from overwhelming assistive technology users,
 *   the ticker container is explicitly configured with `aria-live="off"`.
 * - It provides a visually-hidden description (`.sr-only`) linked via `aria-describedby`
 *   to clearly explain the ticker's purpose without noisy live announcements.
 */
import { useEffect, useState } from "react";
import { server } from "@/lib/stellar";
import { formatAmount, formatTime, formatXLM, shortenAddress } from "@/utils/format";

export interface TickerItem {
  id: string;
  from: string;
  amount: string;
  asset: string;
  time: string;
}

export default function DonationTicker({
  initialItems = [],
}: {
  initialItems?: TickerItem[];
} = {}) {
  const [items, setItems] = useState<TickerItem[]>(initialItems);

  useEffect(() => {
    // Fetch initial latest payments
    server.payments()
      .limit(5)
      .order("desc")
      .call()
      .then((resp) => {
        if (!resp || !resp.records || resp.records.length === 0) return;
        const initial = resp.records.map((r: any) => ({
          id: r.id,
          from: r.from || r.funder || r.account,
          amount: r.amount || "0",
          asset: r.asset_code || "XLM",
          time: formatTime(r.created_at),
        }));
        setItems(initial);
      })
      .catch((err) => {
        // Horizon network fallback
      });


    // Stream new payments
    const closeStream = server.payments()
      .cursor("now")
      .stream({
        onmessage: (payment: any) => {
          const newItem = {
            id: payment.id,
            from: payment.from || payment.funder || payment.account,
            amount: payment.amount || "0",
            asset: payment.asset_code || "XLM",
            time: formatTime(payment.created_at),
          };
          setItems((prev) => [newItem, ...prev.slice(0, 9)]);
        },
        onerror: (err) => console.error("Horizon SSE Error:", err),
      });

    return () => {
      if (typeof closeStream === "function") {
        closeStream();
      }
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Live Network Activity"
      aria-live="off"
      aria-describedby="donation-ticker-description"
      className="fixed bottom-0 left-0 right-0 bg-forest-900/90 backdrop-blur-md text-white py-2 overflow-hidden border-t border-forest-700 z-40"
    >
      <span id="donation-ticker-description" className="sr-only">
        Live donation ticker showing recent network transactions. Announcements are disabled to prevent spamming screen readers.
      </span>
      <div className="flex items-center gap-8 animate-marquee motion-reduce:animate-none whitespace-nowrap px-4">
        <span className="text-forest-400 font-bold uppercase tracking-widest text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" />
          Live Network Activity
        </span>
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 text-sm">
            <span className="text-forest-300">{shortenAddress(item.from)}</span>
            <span className="font-mono text-emerald-400">
              +{item.asset === "XLM" ? formatXLM(item.amount) : `${formatAmount(parseFloat(item.amount), 2, undefined, 2)} ${item.asset}`}
            </span>
            <span className="text-forest-500 text-xs">{item.time}</span>
          </div>
        ))}
      </div>
      <style jsx>{`
        .animate-marquee {
          display: inline-flex;
          animation: marquee 30s linear infinite;
        }
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}


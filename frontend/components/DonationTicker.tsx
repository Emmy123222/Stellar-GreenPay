/**
 * components/DonationTicker.tsx
 * Real-time donation ticker using Horizon SSE.
 */
import { useEffect, useState } from "react";
import { server } from "@/lib/stellar";
import { shortenAddress } from "@/utils/format";

interface TickerItem {
  id: string;
  from: string;
  amount: string;
  asset: string;
  time: string;
}

export default function DonationTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    // Fetch initial latest payments
    server.payments()
      .limit(5)
      .order("desc")
      .call()
      .then((resp) => {
        const initial = resp.records.map((r: any) => ({
          id: r.id,
          from: r.from || r.funder || r.account,
          amount: r.amount || "0",
          asset: r.asset_code || "XLM",
          time: new Date(r.created_at).toLocaleTimeString(),
        }));
        setItems(initial);
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
            time: new Date(payment.created_at).toLocaleTimeString(),
          };
          setItems((prev) => [newItem, ...prev.slice(0, 9)]);
        },
        onerror: (err) => console.error("Horizon SSE Error:", err),
      });

    return () => closeStream();
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-forest-900/90 backdrop-blur-md text-white py-2 overflow-hidden border-t border-forest-700 z-40">
      <div className="flex items-center gap-8 animate-marquee whitespace-nowrap px-4">
        <span className="text-forest-400 font-bold uppercase tracking-widest text-xs flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live Network Activity
        </span>
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 text-sm">
            <span className="text-forest-300">{shortenAddress(item.from)}</span>
            <span className="font-mono text-emerald-400">+{item.amount} {item.asset}</span>
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

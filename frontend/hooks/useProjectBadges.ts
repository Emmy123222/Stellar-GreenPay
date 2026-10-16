import { useEffect } from "react";
import { shortenAddress } from "@/utils/format";
import type { ToastItem } from "@/components/ToastNotification";

export function useProjectBadges(
  projectId?: string,
  onNewToast?: (toast: ToastItem) => void,
) {
  useEffect(() => {
    if (!projectId || !onNewToast) return;
    let socket: any = null;
    let mounted = true;

    (async () => {
      try {
        const { io } = await import("socket.io-client");
        const base = process.env.NEXT_PUBLIC_API_URL || window.location.origin;
        socket = io(base, { path: "/socket.io", transports: ["websocket"] });

        socket.on("connect", () => {
          socket.emit("join_project", projectId);
        });

        socket.on("badge_earned", (payload: { donorAddress: string; badge: string; projectId: string }) => {
          if (!mounted) return;
          if (payload.projectId !== projectId) return;
          onNewToast({
            id: `badge-${Date.now()}-${payload.donorAddress}`,
            title: "New badge earned!",
            description: `${shortenAddress(payload.donorAddress)} earned a ${payload.badge} badge`,
            createdAt: Date.now(),
          });
        });
      } catch (e) {
        // ignore client-side load failures
      }
    })();

    return () => {
      mounted = false;
      try {
        if (socket) {
          socket.emit("leave_project", projectId);
          if (typeof socket.disconnect === "function") socket.disconnect();
        }
      } catch (e) {
        // ignore
      }
    };
  }, [projectId, onNewToast]);
}

interface DegradedBannerProps {
  title?: string;
  message: string;
}

export default function DegradedBanner({
  title = "Some services need attention",
  message,
}: DegradedBannerProps) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}

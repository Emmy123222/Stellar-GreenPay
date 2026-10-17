/**
 * components/SkipLink.tsx — Accessible skip-to-content navigation link.
 *
 * Provides a visually-hidden anchor for keyboard and screen-reader users
 * as the first focusable element on every page. Styled using Tailwind's
 * `sr-only focus:not-sr-only` pattern to become visible on focus, targeting
 * the primary `<main id="main-content">` landmark.
 */
import { useI18n } from "@/lib/i18n";

export interface SkipLinkProps {
  /** Target element ID to jump and shift focus to. Defaults to "main-content". */
  targetId?: string;
  /** Optional custom styling classes. */
  className?: string;
  /** Optional child node; defaults to translated "Skip to main content" label. */
  children?: React.ReactNode;
}

export default function SkipLink({
  targetId = "main-content",
  className,
  children,
}: SkipLinkProps) {
  const { t } = useI18n();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(targetId);
    if (target) {
      if (!target.hasAttribute("tabIndex") && !target.hasAttribute("tabindex")) {
        target.setAttribute("tabindex", "-1");
      }
      target.focus();
      if (typeof target.scrollIntoView === "function") {
        target.scrollIntoView();
      }
    }
  };

  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
      className={
        className ??
        "sr-only focus:not-sr-only focus:fixed focus:top-4 focus:start-4 focus:left-4 rtl:focus:left-auto rtl:focus:right-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-forest-600 focus:text-white dark:focus:bg-forest-500 focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-forest-500 font-medium text-sm transition-all"
      }
    >
      {children ?? t("nav.skipToContent")}
    </a>
  );
}

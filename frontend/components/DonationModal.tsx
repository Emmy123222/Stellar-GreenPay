/**
 * components/DonationModal.tsx
 * Accessible modal wrapper for the donation form.
 * - aria-modal, role="dialog", aria-labelledby
 * - Focus moved to dialog on open
 * - Focus trap while open (Tab / Shift+Tab cycling)
 * - Close on Escape keypress
 * - Return focus to trigger button on close
 * - Background content inert and aria-hidden while open
 * - Prevent body scroll when open
 */
import { useEffect, useRef, useCallback } from "react";
import DonateForm from "./DonateForm";
import type { ClimateProject } from "@/utils/types";

interface DonationModalProps {
  project: ClimateProject;
  publicKey: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type='hidden'])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1']):not([disabled])",
  ].join(", ");

  const elements = Array.from(container.querySelectorAll<HTMLElement>(selector));
  return elements.filter((el) => {
    return (
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-hidden") !== "true" &&
      !el.hidden &&
      el.style.display !== "none" &&
      el.style.visibility !== "hidden"
    );
  });
}

export default function DonationModal({
  project,
  publicKey,
  isOpen,
  onClose,
  onSuccess,
}: DonationModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus dialog on open, return focus on close, and make background inert/aria-hidden
  useEffect(() => {
    if (!isOpen) return;

    if (!previousFocusRef.current && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    modalRef.current?.focus();

    // Make background content inert and aria-hidden
    const modifiedElements: Array<{
      el: HTMLElement;
      prevAriaHidden: string | null;
      prevInert: boolean;
    }> = [];

    let current: HTMLElement | null = overlayRef.current;
    while (current && current !== document.body) {
      const parent = current.parentElement;
      if (!parent) break;

      for (const sibling of Array.from(parent.children)) {
        if (
          sibling instanceof HTMLElement &&
          sibling !== current &&
          !sibling.contains(overlayRef.current)
        ) {
          modifiedElements.push({
            el: sibling,
            prevAriaHidden: sibling.getAttribute("aria-hidden"),
            prevInert: sibling.hasAttribute("inert"),
          });
          sibling.setAttribute("aria-hidden", "true");
          sibling.setAttribute("inert", "");
          try {
            (sibling as any).inert = true;
          } catch {
            // ignore if inert property not supported
          }
        }
      }
      current = parent;
    }

    return () => {
      // Restore background content
      for (const { el, prevAriaHidden, prevInert } of modifiedElements) {
        if (prevAriaHidden === null) {
          el.removeAttribute("aria-hidden");
        } else {
          el.setAttribute("aria-hidden", prevAriaHidden);
        }

        if (!prevInert) {
          el.removeAttribute("inert");
          try {
            (el as any).inert = false;
          } catch {
            // ignore
          }
        } else {
          el.setAttribute("inert", "");
          try {
            (el as any).inert = true;
          } catch {
            // ignore
          }
        }
      }

      // Return focus to trigger element on close
      if (previousFocusRef.current) {
        if (previousFocusRef.current.isConnected) {
          previousFocusRef.current.focus();
        }
        previousFocusRef.current = null;
      }
    };
  }, [isOpen]);

  // Focus trap and escape handling
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== "Tab" || !modalRef.current) return;

      const focusableElements = getFocusableElements(modalRef.current);

      if (focusableElements.length === 0) {
        e.preventDefault();
        modalRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (
          document.activeElement === firstElement ||
          document.activeElement === modalRef.current ||
          !modalRef.current.contains(document.activeElement)
        ) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (
          document.activeElement === lastElement ||
          document.activeElement === modalRef.current ||
          !modalRef.current.contains(document.activeElement)
        ) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    },
    [onClose]
  );

  // Attach/detach keydown listener
  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in motion-reduce:animate-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="donation-modal-title"
        tabIndex={-1}
        className="relative w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl animate-slide-up motion-reduce:animate-none max-h-[90vh] overflow-y-auto outline-none"
      >
        {/* Hidden title for screen readers */}
        <h2 id="donation-modal-title" className="sr-only">
          Donate to {project.name}
        </h2>

        {/* Close button */}
        <button
          ref={closeButtonRef}
          onClick={onClose}
          aria-label="Close donation widget"
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-forest-100 text-forest-700 hover:bg-forest-200 transition-colors"
        >
          ✕
        </button>

        {/* Donation form */}
        <div className="p-6">
          <DonateForm
            project={project}
            publicKey={publicKey}
            onSuccess={() => {
              onSuccess?.();
            }}
          />
        </div>
      </div>
    </div>
  );
}

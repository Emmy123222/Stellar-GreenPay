/**
 * components/DonationModal.tsx
 * Accessible modal wrapper for the donation form.
 * - aria-modal, role="dialog", aria-labelledby
 * - Focus trap while open
 * - Close on Escape keypress
 * - Return focus to trigger button on close
 */
import { useState, useEffect, useRef, useCallback } from "react";
import DonateForm from "./DonateForm";
import type { ClimateProject } from "@/utils/types";

interface DonationModalProps {
  project: ClimateProject;
  publicKey: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function DonationModal({
  project,
  publicKey,
  isOpen,
  onClose,
  onSuccess,
}: DonationModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Store the element that had focus before opening
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Focus the close button when modal opens
      setTimeout(() => closeButtonRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Return focus to trigger element on close
  useEffect(() => {
    if (!isOpen && previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  // Focus trap
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== "Tab" || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="donation-modal-title"
        className="relative w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto"
      >
        {/* Hidden title for screen readers */}
        <h2 id="donation-modal-title" className="sr-only">
          Donate to {project.name}
        </h2>

        {/* Close button */}
        <button
          ref={closeButtonRef}
          onClick={onClose}
          aria-label="Close donation dialog"
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
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import styles from "./AppShell.module.css";

export default function MobileNavButton() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sidebar = document.querySelector<HTMLElement>("[data-app-sidebar]");

    if (open) {
      document.body.setAttribute("data-nav-open", "true");
      if (sidebar) {
        sidebar.removeAttribute("aria-hidden");
        sidebar.removeAttribute("inert");
        // Move focus into the drawer for keyboard users.
        const firstFocusable = sidebar.querySelector<HTMLElement>(
          'a, button, [tabindex]:not([tabindex="-1"])',
        );
        firstFocusable?.focus();
      }
    } else {
      document.body.removeAttribute("data-nav-open");
      if (sidebar) {
        // Only hide when the viewport is in mobile drawer mode. On desktop
        // the sidebar is always visible regardless of `open`, so we use a
        // matchMedia check to avoid hiding the desktop nav.
        const isMobile = window.matchMedia("(max-width: 900px)").matches;
        if (isMobile) {
          sidebar.setAttribute("aria-hidden", "true");
          sidebar.setAttribute("inert", "");
        } else {
          sidebar.removeAttribute("aria-hidden");
          sidebar.removeAttribute("inert");
        }
      }
      // Return focus to the trigger on close.
      if (wasOpenRef.current) triggerRef.current?.focus();
    }
    wasOpenRef.current = open;

    return () => {
      if (typeof document === "undefined") return;
      document.body.removeAttribute("data-nav-open");
    };
  }, [open]);

  // Initialize hidden state on mount + react to viewport changes so we never
  // leave the sidebar tabbable while it is off-canvas.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sidebar = document.querySelector<HTMLElement>("[data-app-sidebar]");
    if (!sidebar) return;
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => {
      if (mq.matches && !open) {
        sidebar.setAttribute("aria-hidden", "true");
        sidebar.setAttribute("inert", "");
      } else {
        sidebar.removeAttribute("aria-hidden");
        sidebar.removeAttribute("inert");
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.mobileNavButton}
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        aria-controls="app-sidebar"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      {open ? (
        <div
          className={styles.mobileNavBackdrop}
          role="presentation"
          onClick={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

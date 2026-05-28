"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type CodingHelperReport = {
  id: string;
  date: string;
  codes: string;
  auditSummary: string;
  formSummary: string;
};

export type InlineCodingHelperHandle = {
  generateReport: () => CodingHelperReport | null;
  isReady: () => boolean;
};

declare global {
  interface Window {
    __theraCodingHelperBootstrapped?: boolean;
    generateAll?: () => void;
    initLibraries?: () => void;
    refreshVisiblePages?: () => void;
    updateProgress?: () => void;
    getLatestCodingReport?: () => unknown;
  }
}

const InlineCodingHelper = forwardRef<InlineCodingHelperHandle>(function InlineCodingHelper(_props, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHelper() {
      try {
        const response = await fetch("/clinical-coding-tool.html", { cache: "no-store" });
        const html = await response.text();
        if (!response.ok) {
          throw new Error(`Failed to load coding helper (${response.status})`);
        }
        if (cancelled || !hostRef.current) return;

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const shell = doc.querySelector(".dashboard-main .shell") ?? doc.querySelector(".shell") ?? doc.body;
        const styleText = Array.from(doc.querySelectorAll("style"))
          .map((node) => node.textContent || "")
          .join("\n");

        hostRef.current.innerHTML = "";

        const styleNode = document.createElement("style");
        styleNode.setAttribute("data-inline-coding-helper", "styles");
        styleNode.textContent = `${styleText}\n.dashboard-main,.dashboard-shell,.dashboard-body{background:transparent !important;} .shell{max-width:none !important; padding:0 !important;} .wrap{padding:0 !important;}`;
        hostRef.current.appendChild(styleNode);

        const contentWrapper = document.createElement("div");
        contentWrapper.setAttribute("data-inline-coding-helper", "content");
        contentWrapper.innerHTML = shell.outerHTML;
        hostRef.current.appendChild(contentWrapper);

        if (!window.__theraCodingHelperBootstrapped) {
          const scripts = Array.from(doc.querySelectorAll("script"));
          for (const script of scripts) {
            const scriptNode = document.createElement("script");
            const src = script.getAttribute("src");
            if (src) {
              scriptNode.src = src;
              scriptNode.async = false;
            } else {
              scriptNode.textContent = script.textContent || "";
            }
            scriptNode.setAttribute("data-inline-coding-helper", "script");
            hostRef.current.appendChild(scriptNode);
          }

          const accessorNode = document.createElement("script");
          accessorNode.setAttribute("data-inline-coding-helper", "accessor");
          accessorNode.textContent = `window.getLatestCodingReport = function(){ try { return latestCodingReport || null; } catch { return null; } };`;
          hostRef.current.appendChild(accessorNode);

          window.__theraCodingHelperBootstrapped = true;
        }

        window.initLibraries?.();
        window.refreshVisiblePages?.();
        window.updateProgress?.();

        if (!cancelled) {
          setReady(true);
          setLoadError(null);
        }
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load coding helper");
        setReady(false);
      }
    }

    void loadHelper();

    return () => {
      cancelled = true;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      generateReport: () => {
        try {
          window.generateAll?.();
          const report = window.getLatestCodingReport?.() as
            | {
                id?: string;
                date?: string;
                codes?: string;
                auditSummary?: string;
                formSummary?: string;
              }
            | null
            | undefined;
          if (!report) return null;

          return {
            id: String(report.id ?? `encounter-${Date.now()}`),
            date: String(report.date ?? new Date().toISOString().slice(0, 10)),
            codes: String(report.codes ?? ""),
            auditSummary: String(report.auditSummary ?? ""),
            formSummary: String(report.formSummary ?? ""),
          };
        } catch {
          return null;
        }
      },
      isReady: () => ready,
    }),
    [ready],
  );

  return (
    <div>
      {loadError ? (
        <p className="muted" style={{ marginBottom: 8 }}>
          {loadError}
        </p>
      ) : null}
      {!ready && !loadError ? (
        <p className="muted" style={{ marginBottom: 8 }}>
          Loading coding helper...
        </p>
      ) : null}
      <div ref={hostRef} />
    </div>
  );
});

export default InlineCodingHelper;

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

const HELPER_BUILD_ID = "2026-05-28.2";

type HelperWindow = Window & {
  generateAll?: () => void;
  getLatestCodingReport?: () => unknown;
};

const InlineCodingHelper = forwardRef<InlineCodingHelperHandle>(function InlineCodingHelper(_props, ref) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cacheBust] = useState(() => Date.now());

  useEffect(() => {
    setReady(false);
    setLoadError(null);

    const iframe = iframeRef.current;
    if (!iframe) return;

    function handleLoad() {
      try {
        const helperWin = iframe.contentWindow as HelperWindow | null;
        const helperDoc = iframe.contentDocument;
        if (helperDoc) {
          const accessorNode = helperDoc.createElement("script");
          accessorNode.textContent = "window.getLatestCodingReport = function(){ try { return latestCodingReport || null; } catch { return null; } };";
          helperDoc.body.appendChild(accessorNode);
        }
        if (helperWin) {
          setReady(true);
          setLoadError(null);
          return;
        }
        setReady(false);
        setLoadError("Coding helper iframe did not initialize.");
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Unable to load coding helper");
        setReady(false);
      }
    }

    function handleError() {
      setReady(false);
      setLoadError("Unable to load coding helper iframe");
    }

    iframe.addEventListener("load", handleLoad);
    iframe.addEventListener("error", handleError);

    return () => {
      iframe.removeEventListener("load", handleLoad);
      iframe.removeEventListener("error", handleError);
    };
  }, [cacheBust]);

  useImperativeHandle(
    ref,
    () => ({
      generateReport: () => {
        try {
          const helperWin = iframeRef.current?.contentWindow as HelperWindow | null;
          helperWin?.generateAll?.();
          const report = helperWin?.getLatestCodingReport?.() as
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
      <p className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
        Coding Helper Build: {HELPER_BUILD_ID}
      </p>
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
      <iframe
        ref={iframeRef}
        title="Coding Helper"
        src={`/clinical-coding-tool.html?ts=${cacheBust}`}
        style={{ width: "100%", minHeight: "72vh", border: "1px solid var(--line, #d9e7f4)", borderRadius: 8, background: "#fff" }}
      />
    </div>
  );
});

export default InlineCodingHelper;

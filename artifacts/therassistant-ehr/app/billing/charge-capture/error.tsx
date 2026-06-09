"use client";

import { useEffect } from "react";

export default function ChargeCaptureError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("Charge Capture route error:", error);
  }, [error]);

  return (
    <div style={{ padding: 40, maxWidth: 640, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, color: "#0f172a", marginBottom: 8 }}>Something went wrong</h1>
      <p style={{ color: "#475569", marginBottom: 20 }}>
        The charge capture page failed to load. This usually means a temporary data or network issue.
      </p>
      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: 12, fontSize: 13, color: "#991b1b", marginBottom: 20, fontFamily: "ui-monospace, monospace" }}>
        {error.message}
      </div>
      <button
        onClick={() => reset()}
        style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontWeight: 600 }}
      >
        Try again
      </button>
    </div>
  );
}

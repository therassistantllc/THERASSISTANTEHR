"use client";

import { useCallback, useState } from "react";
import {
  CLAIM_DOC_MAX_UPLOAD_BYTES,
  uploadClaimDocumentWithProgress,
} from "@/lib/billing/uploadClaimDocument";

export type ClaimUploadStatus = "uploading" | "success" | "error";

export type ClaimUploadItem = {
  key: string;
  claimId: string;
  claimLabel: string;
  name: string;
  size: number;
  progress: number;
  status: ClaimUploadStatus;
  error?: string;
};

export function useClaimDocumentUploads(organizationId: string) {
  const [uploads, setUploads] = useState<ClaimUploadItem[]>([]);

  const dismiss = useCallback((key: string) => {
    setUploads((prev) => prev.filter((u) => u.key !== key));
  }, []);

  const uploadFiles = useCallback(
    (
      claimId: string,
      claimLabel: string,
      files: File[],
      onAnySuccess?: () => void,
    ) => {
      if (files.length === 0) return;
      const queued: ClaimUploadItem[] = files.map((f) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}-${f.name}`,
        claimId,
        claimLabel,
        name: f.name,
        size: f.size,
        progress: 0,
        status: "uploading" as ClaimUploadStatus,
      }));

      setUploads((prev) => [...prev, ...queued]);

      queued.forEach((item, i) => {
        const file = files[i];
        if (file.size > CLAIM_DOC_MAX_UPLOAD_BYTES) {
          setUploads((prev) =>
            prev.map((u) =>
              u.key === item.key
                ? {
                    ...u,
                    status: "error",
                    error: `Exceeds ${CLAIM_DOC_MAX_UPLOAD_BYTES / (1024 * 1024)}MB cap`,
                  }
                : u,
            ),
          );
          return;
        }
        if (file.size <= 0) {
          setUploads((prev) =>
            prev.map((u) =>
              u.key === item.key
                ? { ...u, status: "error", error: "File is empty" }
                : u,
            ),
          );
          return;
        }

        void uploadClaimDocumentWithProgress(
          claimId,
          organizationId,
          file,
          (pct) => {
            setUploads((prev) =>
              prev.map((u) =>
                u.key === item.key ? { ...u, progress: pct } : u,
              ),
            );
          },
        ).then((result) => {
          if (result.ok) {
            setUploads((prev) =>
              prev.map((u) =>
                u.key === item.key
                  ? { ...u, progress: 100, status: "success" }
                  : u,
              ),
            );
            onAnySuccess?.();
            window.setTimeout(() => dismiss(item.key), 3000);
          } else {
            setUploads((prev) =>
              prev.map((u) =>
                u.key === item.key
                  ? { ...u, status: "error", error: result.error }
                  : u,
              ),
            );
          }
        });
      });
    },
    [organizationId, dismiss],
  );

  return { uploads, uploadFiles, dismiss };
}

export function ClaimDocumentUploadsOverlay({
  uploads,
  onDismiss,
}: {
  uploads: ClaimUploadItem[];
  onDismiss: (key: string) => void;
}) {
  if (uploads.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 340,
        maxWidth: "92vw",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 1100,
      }}
    >
      {uploads.map((u) => {
        const color =
          u.status === "error"
            ? "#B91C1C"
            : u.status === "success"
              ? "#15803D"
              : "#1D4ED8";
        return (
          <div
            key={u.key}
            style={{
              border: `1px solid ${u.status === "error" ? "#FCA5A5" : u.status === "success" ? "#86EFAC" : "#BFDBFE"}`,
              borderRadius: 6,
              padding: "8px 10px",
              background:
                u.status === "error"
                  ? "#FEF2F2"
                  : u.status === "success"
                    ? "#F0FDF4"
                    : "#EFF6FF",
              boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  color: "#0F172A",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
                title={`${u.name} → ${u.claimLabel}`}
              >
                {u.name}
              </span>
              <span style={{ color, fontWeight: 600 }}>
                {u.status === "error"
                  ? "Failed"
                  : u.status === "success"
                    ? "Uploaded"
                    : `${u.progress}%`}
              </span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#64748B",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={u.claimLabel}
            >
              → {u.claimLabel}
            </div>
            {u.status === "uploading" ? (
              <div
                style={{
                  height: 4,
                  background: "#DBEAFE",
                  borderRadius: 2,
                  marginTop: 6,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${u.progress}%`,
                    height: "100%",
                    background: "#1D4ED8",
                    transition: "width 0.15s ease",
                  }}
                />
              </div>
            ) : null}
            {u.status === "error" && u.error ? (
              <div style={{ color: "#B91C1C", fontSize: 12, marginTop: 4 }}>
                {u.error}
              </div>
            ) : null}
            {u.status !== "uploading" ? (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => onDismiss(u.key)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#64748B",
                    fontSize: 11,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

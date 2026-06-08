"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CLAIM_DOC_MAX_UPLOAD_BYTES as MAX_UPLOAD_BYTES,
  uploadClaimDocumentWithProgress as uploadFileWithProgress,
} from "@/lib/billing/uploadClaimDocument";

type UploadStatus = "uploading" | "success" | "error";
type UploadItem = {
  key: string;
  name: string;
  size: number;
  progress: number;
  status: UploadStatus;
  error?: string;
};

export type ClaimDocument = {
  id: string;
  title: string;
  fileName: string | null;
  documentType: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  uploadedAt: string | null;
  source: "mailroom" | "fax" | "manual_upload" | "other";
  sourceLabel: string;
  hasFile: boolean;
};

type MailroomPick = {
  id: string;
  fileName: string;
  source: string;
  documentType: string;
  createdAt: string;
};

function formatBytes(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
};
const fieldInput: React.CSSProperties = {
  width: "100%",
  padding: 8,
  border: "1px solid #D1D5DB",
  borderRadius: 4,
  fontFamily: "inherit",
  fontSize: 13,
};
const buttonRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
  marginTop: 16,
};

function ModalShell({
  title,
  onClose,
  children,
  width = 500,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width,
          maxWidth: "92vw",
          maxHeight: "88vh",
          overflow: "auto",
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#6B7280",
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        background: "#111827",
        color: "#fff",
        padding: "10px 16px",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        zIndex: 1100,
      }}
    >
      {message}
    </div>
  );
}

export function AttachClaimDocumentModal({
  claimId,
  organizationId,
  onClose,
  onAttached,
}: {
  claimId: string;
  organizationId: string;
  onClose: () => void;
  onAttached: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"upload" | "mailroom">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [items, setItems] = useState<MailroomPick[] | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [pickedItemId, setPickedItemId] = useState<string>("");

  useEffect(() => {
    if (mode !== "mailroom" || items !== null) return;
    let cancelled = false;
    fetch(
      `/api/mailroom/items?organizationId=${encodeURIComponent(organizationId)}&status=active&limit=100`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.success === false) {
          setItemsError(j.error || "Failed to load mailroom items");
        } else {
          const list = (j?.items ?? []) as Array<Record<string, unknown>>;
          setItems(
            list.map((it) => ({
              id: String(it.id ?? ""),
              fileName: String(it.fileName ?? "document"),
              source: String(it.source ?? ""),
              documentType: String(it.documentType ?? ""),
              createdAt: String(it.createdAt ?? ""),
            })),
          );
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setItemsError(e instanceof Error ? e.message : "Failed to load mailroom items");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mode, items, organizationId]);

  async function submit() {
    setError(null);
    if (mode === "upload") {
      if (!file) {
        setError("Pick a file to upload");
        return;
      }
      setSaving(true);
      const form = new FormData();
      form.set("file", file);
      form.set("organizationId", organizationId);
      if (notes.trim()) form.set("notes", notes.trim());
      const res = await fetch(`/api/billing/claims/${claimId}/documents`, {
        method: "POST",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      setSaving(false);
      if (!res.ok || json?.success === false) {
        setError(json?.error || `Upload failed (${res.status})`);
        return;
      }
      onAttached("Document attached to claim");
      onClose();
    } else {
      if (!pickedItemId) {
        setError("Pick a mailroom item to file");
        return;
      }
      setSaving(true);
      const res = await fetch(`/api/billing/claims/${claimId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          mailroomItemId: pickedItemId,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      setSaving(false);
      if (!res.ok || json?.success === false) {
        setError(json?.error || `Filing failed (${res.status})`);
        return;
      }
      onAttached("Mailroom item filed to claim");
      onClose();
    }
  }

  return (
    <ModalShell title="Attach document" onClose={onClose} width={560}>
      <div
        role="tablist"
        aria-label="Attach mode"
        style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "1px solid #E5E7EB" }}
      >
        {(
          [
            { id: "upload", label: "Upload new file" },
            { id: "mailroom", label: "Pick from mailroom" },
          ] as const
        ).map((t) => {
          const active = mode === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setMode(t.id);
                setError(null);
              }}
              style={{
                border: "none",
                background: "transparent",
                padding: "6px 10px",
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? "#1D4ED8" : "#475569",
                borderBottom: active ? "2px solid #1D4ED8" : "2px solid transparent",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {mode === "upload" ? (
        <div>
          <label style={fieldLabel}>File</label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={fieldInput}
          />
          <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>
            Up to 25 MB. PDF, image, or office doc.
          </div>
        </div>
      ) : (
        <div>
          <label style={fieldLabel}>Mailroom item</label>
          {itemsError ? (
            <div style={{ color: "#B91C1C", fontSize: 13 }}>{itemsError}</div>
          ) : items == null ? (
            <div style={{ color: "#94A3B8", fontSize: 13 }}>Loading mailroom items…</div>
          ) : items.length === 0 ? (
            <div style={{ color: "#94A3B8", fontSize: 13 }}>
              No unfiled mailroom items.
            </div>
          ) : (
            <select
              value={pickedItemId}
              onChange={(e) => setPickedItemId(e.target.value)}
              style={fieldInput}
            >
              <option value="">— Pick an item —</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.fileName}
                  {it.source ? ` · ${it.source}` : ""}
                  {it.documentType ? ` · ${it.documentType}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <label style={{ ...fieldLabel, marginTop: 12 }}>Notes (optional)</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        style={fieldInput}
      />

      {error ? (
        <div style={{ color: "#B91C1C", marginTop: 8, fontSize: 13 }}>{error}</div>
      ) : null}

      <div style={buttonRow}>
        <button
          type="button"
          className="button button-secondary"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
        <button type="button" className="button" onClick={submit} disabled={saving}>
          {saving ? "Attaching…" : "Attach"}
        </button>
      </div>
    </ModalShell>
  );
}

export function ClaimDocumentsPanel({
  claimId,
  organizationId,
}: {
  claimId: string;
  organizationId: string;
}) {
  const [docs, setDocs] = useState<ClaimDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bumpKey, setBumpKey] = useState(0);
  const [attachOpen, setAttachOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const queued: UploadItem[] = files.map((f) => ({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}-${f.name}`,
        name: f.name,
        size: f.size,
        progress: 0,
        status: "uploading" as UploadStatus,
      }));

      setUploads((prev) => [...prev, ...queued]);

      queued.forEach((item, i) => {
        const file = files[i];
        if (file.size > MAX_UPLOAD_BYTES) {
          setUploads((prev) =>
            prev.map((u) =>
              u.key === item.key
                ? {
                    ...u,
                    status: "error",
                    error: `Exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB cap`,
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

        void uploadFileWithProgress(claimId, organizationId, file, (pct) => {
          setUploads((prev) =>
            prev.map((u) => (u.key === item.key ? { ...u, progress: pct } : u)),
          );
        }).then((result) => {
          if (result.ok) {
            setUploads((prev) =>
              prev.map((u) =>
                u.key === item.key
                  ? { ...u, progress: 100, status: "success" }
                  : u,
              ),
            );
            setBumpKey((k) => k + 1);
            setToast(
              files.length === 1
                ? "Document attached to claim"
                : `${files.length} documents attached`,
            );
            window.setTimeout(() => {
              setUploads((prev) => prev.filter((u) => u.key !== item.key));
            }, 2500);
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
    [claimId, organizationId],
  );

  const onDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) handleFiles(files);
  };

  useEffect(() => {
    let cancelled = false;
    setDocs(null);
    setError(null);
    fetch(
      `/api/billing/claims/${claimId}/documents?organizationId=${encodeURIComponent(organizationId)}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.success === false) setError(j.error || "Failed to load documents");
        else setDocs((j?.documents ?? []) as ClaimDocument[]);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load documents");
      });
    return () => {
      cancelled = true;
    };
  }, [claimId, organizationId, bumpKey]);

  const attachButton = (
    <button
      type="button"
      className="button"
      onClick={() => setAttachOpen(true)}
      style={{ fontSize: 12, padding: "4px 10px" }}
    >
      Attach document
    </button>
  );

  const header = (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>
        Documents
      </div>
      {attachButton}
    </div>
  );

  const modal = attachOpen ? (
    <AttachClaimDocumentModal
      claimId={claimId}
      organizationId={organizationId}
      onClose={() => setAttachOpen(false)}
      onAttached={(msg) => {
        setBumpKey((k) => k + 1);
        setToast(msg);
      }}
    />
  ) : null;

  const toastEl = toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null;

  const uploadsList =
    uploads.length === 0 ? null : (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          marginBottom: 8,
        }}
        aria-live="polite"
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
                border: `1px solid ${u.status === "error" ? "#FCA5A5" : "#BFDBFE"}`,
                borderRadius: 6,
                padding: "8px 10px",
                background: u.status === "error" ? "#FEF2F2" : "#EFF6FF",
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
                  title={u.name}
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
            </div>
          );
        })}
      </div>
    );

  const dropOverlay = isDragging ? (
    <div
      style={{
        position: "absolute",
        inset: 0,
        border: "2px dashed #1D4ED8",
        background: "rgba(219, 234, 254, 0.7)",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        color: "#1D4ED8",
        fontSize: 14,
        fontWeight: 600,
        zIndex: 5,
      }}
    >
      Drop files to attach to this claim
    </div>
  ) : null;

  let body: React.ReactNode;
  if (error) {
    body = <div style={{ color: "#B91C1C", fontSize: 13 }}>{error}</div>;
  } else if (docs == null) {
    body = (
      <div style={{ color: "#94A3B8", fontSize: 13 }}>Loading documents…</div>
    );
  } else if (docs.length === 0) {
    body = (
      <div style={{ color: "#94A3B8", fontSize: 13 }}>
        No documents linked to this claim yet. Drag a file onto this panel, or
        use “Attach document” to upload a file or file an existing mailroom
        item against this claim.
      </div>
    );
  } else {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {docs.map((d) => {
          const href = `/api/billing/claims/${claimId}/documents/${d.id}/file?organizationId=${encodeURIComponent(organizationId)}`;
          const size = formatBytes(d.fileSizeBytes);
          return (
            <div
              key={d.id}
              style={{
                border: "1px solid #E5E7EB",
                borderRadius: 6,
                padding: 10,
                background: "#F9FAFB",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#0F172A",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={d.fileName ?? d.title}
                >
                  {d.fileName ?? d.title}
                </div>
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                  {d.sourceLabel}
                  {" · "}
                  {formatDate(d.uploadedAt)}
                  {size ? ` · ${size}` : ""}
                  {d.documentType ? ` · ${d.documentType}` : ""}
                </div>
              </div>
              {d.hasFile ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="button button-secondary"
                  style={{ fontSize: 12, padding: "4px 10px", whiteSpace: "nowrap" }}
                >
                  Open
                </a>
              ) : (
                <span style={{ fontSize: 12, color: "#94A3B8" }}>No file</span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: "relative",
        borderRadius: 6,
        padding: isDragging ? 8 : 0,
        transition: "padding 0.15s ease",
      }}
      data-testid="claim-documents-panel"
    >
      {header}
      {uploadsList}
      {body}
      {dropOverlay}
      {modal}
      {toastEl}
    </div>
  );
}

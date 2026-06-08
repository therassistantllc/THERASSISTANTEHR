"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type DocItem = {
  id: string;
  scope: string | null;
  type: string | null;
  title: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  notes: string | null;
  filedAt: string | null;
  createdAt: string | null;
  encounterId: string | null;
  claimId: string | null;
  mailroomItemId: string | null;
  patientVisible: boolean;
};

function formatDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
}

function formatSize(bytes: number | null | undefined) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const params = useParams<{ clientId?: string; id?: string }>();
  const clientId = params?.clientId ?? params?.id ?? "";
  const searchParams = useSearchParams();
  const orgId = searchParams.get("organizationId") ?? process.env.NEXT_PUBLIC_ORGANIZATION_ID ?? "";

  const [documents, setDocuments] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  async function togglePatientVisible(docId: string, next: boolean) {
    setSavingId(docId);
    const prev = documents;
    setDocuments((rows) =>
      rows.map((d) => (d.id === docId ? { ...d, patientVisible: next } : d)),
    );
    try {
      const r = await fetch(
        `/api/patients/${clientId}/documents/${docId}?organizationId=${encodeURIComponent(orgId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientVisible: next }),
        },
      );
      const json = (await r.json()) as { success: boolean; error?: string };
      if (!json.success) throw new Error(json.error ?? "Failed to update");
    } catch (e: unknown) {
      setDocuments(prev);
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSavingId(null);
    }
  }

  useEffect(() => {
    if (!clientId || !orgId) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/patients/${clientId}/documents?organizationId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
        const json = await r.json() as { success: boolean; documents?: DocItem[]; error?: string };
        if (cancelled) return;
        if (!json.success) throw new Error(json.error ?? "Failed");
        const nextDocs = json.documents ?? [];
        setDocuments(nextDocs);
        setSelectedDocumentId((prev) => {
          if (prev && nextDocs.some((doc) => doc.id === prev)) return prev;
          return nextDocs[0]?.id ?? null;
        });
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [clientId, orgId]);

  const orgQ = orgId ? `?organizationId=${encodeURIComponent(orgId)}` : "";
  const selectedDocument = documents.find((doc) => doc.id === selectedDocumentId) ?? null;
  const selectedDocumentUrl = selectedDocument
    ? `/api/patients/${clientId}/documents/${selectedDocument.id}?organizationId=${encodeURIComponent(orgId)}`
    : "";
  const selectedMime = String(selectedDocument?.mimeType ?? "").toLowerCase();
  const isPdf = selectedMime.includes("pdf") || String(selectedDocument?.fileName ?? "").toLowerCase().endsWith(".pdf");
  const isImage = selectedMime.startsWith("image/");

  return (
    <main className="app-shell">
      <section className="page-header">
        <div>
          <p className="eyebrow">Client Chart</p>
          <h2>Documents &amp; Attachments</h2>
        </div>
        <div className="hero-actions">
          <Link className="button button-secondary" href={`/mailroom${orgQ}`}>
            Mailroom
          </Link>
        </div>
      </section>

      {loading && <div className="empty-state">Loading documents…</div>}
      {error && <div className="alert-panel">{error}</div>}

      {!loading && documents.length === 0 && !error && (
        <div className="empty-state">
          No documents found. Documents are filed here from the Mailroom or attached to encounters.
        </div>
      )}

      {documents.length > 0 && (
        <section
          className="panel"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div>
            <h3 style={{ marginTop: 0 }}>Documents</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th aria-label="Select" />
                  <th>File / Title</th>
                  <th>Type</th>
                  <th>Filed</th>
                  <th>Client portal</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const selected = doc.id === selectedDocumentId;
                  return (
                    <tr
                      key={doc.id}
                      onClick={() => setSelectedDocumentId(doc.id)}
                      style={{
                        cursor: "pointer",
                        background: selected ? "rgba(29, 78, 216, 0.08)" : undefined,
                      }}
                    >
                      <td>
                        <input
                          type="radio"
                          name="selectedDocument"
                          checked={selected}
                          onChange={() => setSelectedDocumentId(doc.id)}
                          aria-label={`Select ${doc.title ?? doc.fileName ?? "document"}`}
                        />
                      </td>
                      <td>
                        <div>
                          <strong>{doc.title ?? doc.fileName ?? "Untitled"}</strong>
                          {doc.fileName && doc.title ? (
                            <div className="muted" style={{ fontSize: "12px" }}>{doc.fileName}</div>
                          ) : null}
                        </div>
                      </td>
                      <td>{doc.type ?? "—"}</td>
                      <td>{doc.filedAt ? formatDate(doc.filedAt) : <span className="muted">Not filed</span>}</td>
                      <td>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={doc.patientVisible}
                            disabled={savingId === doc.id}
                            onChange={(e) => togglePatientVisible(doc.id, e.target.checked)}
                            onClick={(event) => event.stopPropagation()}
                          />
                          {doc.patientVisible ? "Visible" : "Hidden"}
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <h3 style={{ marginTop: 0 }}>Document Preview</h3>
            {!selectedDocument ? (
              <p className="muted" style={{ marginTop: 0 }}>
                Select a document to preview.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="detail-list">
                  <p><strong>Title:</strong> {selectedDocument.title ?? selectedDocument.fileName ?? "Untitled"}</p>
                  <p><strong>Type:</strong> {selectedDocument.type ?? "—"}</p>
                  <p><strong>Scope:</strong> {selectedDocument.scope ?? "—"}</p>
                  <p><strong>Size:</strong> {formatSize(selectedDocument.fileSizeBytes)}</p>
                  <p><strong>Created:</strong> {formatDate(selectedDocument.createdAt)}</p>
                </div>

                {(isPdf || isImage) ? (
                  <div
                    style={{
                      border: "1px solid var(--border-color, #CBD5E1)",
                      borderRadius: 8,
                      minHeight: 520,
                      overflow: "hidden",
                      background: "#fff",
                    }}
                  >
                    {isPdf ? (
                      <iframe
                        title="Document preview"
                        src={selectedDocumentUrl}
                        style={{ width: "100%", height: 520, border: 0 }}
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedDocumentUrl}
                        alt={selectedDocument.title ?? selectedDocument.fileName ?? "Document preview"}
                        style={{ width: "100%", height: 520, objectFit: "contain", background: "#f8fafc" }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="empty-state" style={{ margin: 0 }}>
                    Preview is not available for this file type.
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a className="button button-secondary" href={selectedDocumentUrl} target="_blank" rel="noreferrer">
                    Open File
                  </a>
                  {selectedDocument.encounterId ? (
                    <Link className="button button-secondary" href={`/encounters/${selectedDocument.encounterId}${orgQ}`}>
                      Open Encounter
                    </Link>
                  ) : null}
                  {selectedDocument.mailroomItemId ? (
                    <Link className="button button-secondary" href={`/mailroom/${selectedDocument.mailroomItemId}${orgQ}`}>
                      Open Mailroom Item
                    </Link>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

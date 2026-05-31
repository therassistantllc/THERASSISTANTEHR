"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type NoteItem = {
  id: string;
  encounterId: string;
  encounterDate: string | null;
  encounterStatus: string | null;
  noteStatus: string | null;
  noteType: string | null;
  signedAt: string | null;
  createdAt: string | null;
  hasSoapNote: boolean;
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
};

function formatDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(`${v}`.includes("T") ? v : `${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString();
}

function statusClass(v: string | null | undefined) {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("signed") || s.includes("complet")) return "status status-green";
  if (s.includes("draft") || s.includes("in_progress")) return "status status-yellow";
  if (s.includes("amend")) return "status status-yellow";
  return "status";
}

export default function NotesPage() {
  const params = useParams<{ clientId?: string; id?: string }>();
  const clientId = params?.clientId ?? params?.id ?? "";
  const searchParams = useSearchParams();
  const orgId = searchParams.get("organizationId") ?? process.env.NEXT_PUBLIC_ORGANIZATION_ID ?? "";

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId || !orgId) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch(`/api/patients/${clientId}/notes?organizationId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
        const json = await r.json() as { success: boolean; notes?: NoteItem[]; error?: string };
        if (cancelled) return;
        if (!json.success) throw new Error(json.error ?? "Failed");
        const nextNotes = json.notes ?? [];
        setNotes(nextNotes);
        setSelectedNoteId((prev) => {
          if (prev && nextNotes.some((note) => note.id === prev)) return prev;
          return nextNotes[0]?.id ?? null;
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
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const selectedNoteStatus = String(selectedNote?.noteStatus ?? "").toLowerCase();

  return (
    <main className="app-shell">
      <section className="page-header">
        <div>
          <p className="eyebrow">Client Chart</p>
          <h2>Clinical Notes</h2>
        </div>
        <div className="hero-actions">
          <Link className="button" href={`/encounters/new${orgQ}`}>
            New Encounter
          </Link>
        </div>
      </section>

      {loading && <div className="empty-state">Loading notes…</div>}
      {error && <div className="alert-panel">{error}</div>}

      {!loading && notes.length === 0 && !error && (
        <div className="empty-state">No clinical notes found. Notes are created within encounters.</div>
      )}

      {notes.length > 0 && (
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
            <h3 style={{ marginTop: 0 }}>Notes</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th aria-label="Select" />
                  <th>Encounter Date</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Signed</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => {
                  const selected = note.id === selectedNoteId;
                  return (
                    <tr
                      key={note.id}
                      onClick={() => setSelectedNoteId(note.id)}
                      style={{
                        cursor: "pointer",
                        background: selected ? "rgba(29, 78, 216, 0.08)" : undefined,
                      }}
                    >
                      <td>
                        <input
                          type="radio"
                          name="selectedNote"
                          checked={selected}
                          onChange={() => setSelectedNoteId(note.id)}
                          aria-label={`Select note ${formatDate(note.encounterDate)}`}
                        />
                      </td>
                      <td>{formatDate(note.encounterDate)}</td>
                      <td>{note.noteType ?? "—"}</td>
                      <td><span className={statusClass(note.noteStatus)}>{note.noteStatus ?? "draft"}</span></td>
                      <td>{note.signedAt ? formatDate(note.signedAt) : <span className="muted">Unsigned</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <h3 style={{ marginTop: 0 }}>Note Preview</h3>
            {!selectedNote ? (
              <p className="muted" style={{ marginTop: 0 }}>
                Select a note to preview.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="detail-list">
                  <p><strong>Encounter Date:</strong> {formatDate(selectedNote.encounterDate)}</p>
                  <p><strong>Encounter Status:</strong> {selectedNote.encounterStatus ?? "—"}</p>
                  <p><strong>Note Status:</strong> {selectedNote.noteStatus ?? "draft"}</p>
                  <p><strong>Signed:</strong> {selectedNote.signedAt ? formatDate(selectedNote.signedAt) : "Unsigned"}</p>
                </div>

                <article className="panel" style={{ margin: 0 }}>
                  <h4 style={{ marginTop: 0, marginBottom: 8 }}>Subjective</h4>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{selectedNote.subjective?.trim() || "Not documented"}</p>
                </article>
                <article className="panel" style={{ margin: 0 }}>
                  <h4 style={{ marginTop: 0, marginBottom: 8 }}>Objective</h4>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{selectedNote.objective?.trim() || "Not documented"}</p>
                </article>
                <article className="panel" style={{ margin: 0 }}>
                  <h4 style={{ marginTop: 0, marginBottom: 8 }}>Assessment</h4>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{selectedNote.assessment?.trim() || "Not documented"}</p>
                </article>
                <article className="panel" style={{ margin: 0 }}>
                  <h4 style={{ marginTop: 0, marginBottom: 8 }}>Plan</h4>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{selectedNote.plan?.trim() || "Not documented"}</p>
                </article>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link className="button button-secondary" href={`/encounters/${selectedNote.encounterId}${orgQ}`}>
                    Open Encounter
                  </Link>
                  <Link
                    className="button"
                    href={`/encounters/${selectedNote.encounterId}${orgQ}${orgQ ? "&" : "?"}edit=1`}
                  >
                    {selectedNoteStatus === "signed" ? "Amend Note" : "Edit Note"}
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

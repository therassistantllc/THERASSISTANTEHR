"use client";

import { useMemo, useState } from "react";
import { analyzeMedicaidDocumentation } from "@/lib/encounters/medicaidCodeDetection";
import type { SoapNoteData } from "@/components/encounter/SoapNoteEditor";
import type { Diagnosis } from "@/components/encounter/DiagnosisPicker";
import type { ServiceLine } from "@/components/encounter/CptCodePanel";

export type CodingHelperReport = {
  id: string;
  date: string;
  codes: string;
  auditSummary: string;
  formSummary: string;
};

type Props = {
  encounterId: string;
  organizationId: string;
  clientName?: string;
  payerName?: string | null;
  isMedicaid: boolean;
  soapNote: SoapNoteData;
  diagnoses: Diagnosis[];
  serviceLines: ServiceLine[];
  onApplySuggestedCodes: (codes: string[]) => void;
  onSaveReport: (report: CodingHelperReport) => Promise<void>;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function sectionsFromState(params: {
  soapNote: SoapNoteData;
  diagnoses: Diagnosis[];
  serviceLines: ServiceLine[];
  clientName?: string;
  payerName?: string | null;
  isMedicaid: boolean;
}) {
  const { soapNote, diagnoses, serviceLines, clientName, payerName, isMedicaid } = params;
  const diagnosisSummary = diagnoses
    .filter((d) => clean(d.diagnosis_code).length > 0)
    .map((d) => `${clean(d.diagnosis_code)}${clean(d.diagnosis_description) ? ` (${clean(d.diagnosis_description)})` : ""}`)
    .join(", ");

  const serviceSummary = serviceLines
    .map((line) => {
      const code = clean(line.cpt_hcpcs_code) || "(uncoded)";
      const units = Number.isFinite(Number(line.units)) ? Number(line.units) : 1;
      const date = clean(line.service_date);
      return `Code ${code}, units ${units}${date ? `, service date ${date}` : ""}`;
    })
    .join("; ");

  return [
    clean(clientName) ? `Client: ${clean(clientName)}` : "",
    clean(payerName) ? `Payer: ${clean(payerName)}` : "",
    `Coverage: ${isMedicaid ? "Medicaid" : "Non-Medicaid"}`,
    clean(soapNote.subjective) ? `Subjective: ${clean(soapNote.subjective)}` : "",
    clean(soapNote.objective) ? `Objective: ${clean(soapNote.objective)}` : "",
    clean(soapNote.assessment) ? `Assessment: ${clean(soapNote.assessment)}` : "",
    clean(soapNote.plan) ? `Plan: ${clean(soapNote.plan)}` : "",
    diagnosisSummary ? `Diagnoses: ${diagnosisSummary}` : "",
    serviceSummary ? `Service lines: ${serviceSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export default function CodingHelperPanel(props: Props) {
  const {
    encounterId,
    organizationId,
    clientName,
    payerName,
    isMedicaid,
    soapNote,
    diagnoses,
    serviceLines,
    onApplySuggestedCodes,
    onSaveReport,
  } = props;

  const [latestReport, setLatestReport] = useState<CodingHelperReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);

  const documentationText = useMemo(
    () =>
      sectionsFromState({
        soapNote,
        diagnoses,
        serviceLines,
        clientName,
        payerName,
        isMedicaid,
      }),
    [soapNote, diagnoses, serviceLines, clientName, payerName, isMedicaid],
  );

  const analysis = useMemo(() => {
    if (!documentationText.trim()) return null;
    return analyzeMedicaidDocumentation(documentationText);
  }, [documentationText]);

  const suggestedCodes = useMemo(() => {
    if (!analysis) return [] as string[];
    return Array.from(
      new Set(
        analysis.recommendations
          .filter((rec) => rec.action === "suggest" || rec.action === "clarify_before_suggesting")
          .map((rec) => rec.code),
      ),
    );
  }, [analysis]);

  const auditSummary = useMemo(() => {
    if (!analysis) return "No coding support signals detected from current note content.";
    const notes = [...analysis.auditSummary];
    if (analysis.globalWarnings.length > 0) {
      notes.push(`Warnings: ${analysis.globalWarnings.join(" | ")}`);
    }
    return notes.filter(Boolean).join(" ") || "No coding support signals detected from current note content.";
  }, [analysis]);

  function buildReport(): CodingHelperReport {
    const date = new Date().toISOString().slice(0, 10);
    const recommendations = analysis?.recommendations ?? [];
    const recommendationText = recommendations
      .map((rec) => {
        const missing = rec.missingElements.length ? ` Missing: ${rec.missingElements.join("; ")}.` : "";
        const blockerText = rec.blockers.length ? ` Blockers: ${rec.blockers.map((b) => b.label).join("; ")}.` : "";
        return `- ${rec.code} (${rec.action}, ${rec.confidence}): ${rec.explanation}.${missing}${blockerText}`;
      })
      .join("\n");

    const formSummary = [
      `Encounter: ${encounterId}`,
      `Organization: ${organizationId}`,
      clean(clientName) ? `Client: ${clean(clientName)}` : "",
      clean(payerName) ? `Payer: ${clean(payerName)}` : "",
      `Coverage context: ${isMedicaid ? "Medicaid" : "Non-Medicaid"}`,
      "",
      "Suggested codes:",
      suggestedCodes.length ? suggestedCodes.join(", ") : "None",
      "",
      "Recommendations:",
      recommendationText || "No recommendation rows generated.",
      "",
      "Source snapshot:",
      documentationText || "No source note content.",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      id: `coding-helper-${encounterId}-${Date.now()}`,
      date,
      codes: suggestedCodes.join(", "),
      auditSummary,
      formSummary,
    };
  }

  function handleGenerate() {
    setPanelError(null);
    const report = buildReport();
    setLatestReport(report);
    setPanelMessage("Generated coding helper report from current encounter state.");
  }

  function handleApplyCodes() {
    setPanelError(null);
    if (!suggestedCodes.length) {
      setPanelError("No suggested codes are currently available to apply.");
      return;
    }
    onApplySuggestedCodes(suggestedCodes);
    setPanelMessage(`Applied ${suggestedCodes.join(", ")} to service lines.`);
  }

  async function handleSaveReport() {
    setPanelError(null);
    const report = latestReport ?? buildReport();
    setLatestReport(report);

    setSaving(true);
    try {
      await onSaveReport(report);
      setPanelMessage("Saved coding report to encounter records.");
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to save coding report.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ display: "grid", gap: 8 }}>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Client: {clean(clientName) || "Unknown"} · Payer: {clean(payerName) || "Unknown"} · Coverage: {isMedicaid ? "Medicaid" : "Non-Medicaid"}
        </p>
        {!isMedicaid ? (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Medicaid-focused code heuristics are still available, but confidence may be lower for non-Medicaid coverage.
          </p>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button className="button button-secondary" type="button" onClick={handleGenerate}>
          Generate Report
        </button>
        <button className="button button-secondary" type="button" onClick={handleApplyCodes} disabled={!suggestedCodes.length}>
          Apply Suggested Codes
        </button>
        <button className="button" type="button" onClick={handleSaveReport} disabled={saving}>
          {saving ? "Saving…" : "Save Report"}
        </button>
      </div>

      {panelMessage ? (
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          {panelMessage}
        </p>
      ) : null}
      {panelError ? (
        <p className="alert-panel" style={{ marginTop: 10 }}>
          {panelError}
        </p>
      ) : null}

      <div className="detail-list" style={{ marginTop: 12 }}>
        <p>
          <strong>Suggested codes:</strong> {suggestedCodes.length ? suggestedCodes.join(", ") : "None yet"}
        </p>
        <p>
          <strong>Audit summary:</strong> {auditSummary}
        </p>
        {analysis?.globalWarnings.length ? (
          <p>
            <strong>Documentation warnings:</strong> {analysis.globalWarnings.join(" | ")}
          </p>
        ) : null}
      </div>

      {latestReport ? (
        <article className="panel" style={{ marginTop: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Generated Report Preview</h3>
          <p style={{ marginBottom: 8 }}><strong>Report date:</strong> {latestReport.date}</p>
          <p style={{ marginBottom: 8 }}><strong>Codes:</strong> {latestReport.codes || "None"}</p>
          <p style={{ marginBottom: 8 }}><strong>Summary:</strong> {latestReport.auditSummary}</p>
          <details>
            <summary>View full report details</summary>
            <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>{latestReport.formSummary}</pre>
          </details>
        </article>
      ) : null}
    </div>
  );
}

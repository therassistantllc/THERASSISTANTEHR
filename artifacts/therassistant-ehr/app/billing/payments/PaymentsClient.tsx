"use client";

import { useMemo, useState } from "react";
import styles from "./payments.module.css";

type PaymentStatus = "ready" | "partial" | "exception" | "review" | "posted";
type QueueTab = "all" | "era" | "patient" | "checks" | "unapplied" | "exceptions";

interface PaymentItem {
  id: string;
  source: string;
  eraId?: string;
  payer?: string;
  patient?: string;
  amount: number;
  method: "ERA" | "Patient" | "Check" | "Card" | "ACH";
  status: PaymentStatus;
  date: string;
  exception?: string;
}

interface LedgerLine {
  dos: string;
  cpt: string;
  charge: number;
  paid: number;
  adj: number;
  ptResp: number;
  claimStatus: string;
}

const PAYMENTS: PaymentItem[] = [
  { id: "pmt-1", source: "ERA #ERA-2026-0234", eraId: "ERA-2026-0234", payer: "BCBS Colorado", amount: 1248.22, method: "ERA", status: "partial", date: "05/19/2026", exception: "Payment amount exceeds remaining balance by $42.18" },
  { id: "pmt-2", source: "ERA #ERA-2026-0235", eraId: "ERA-2026-0235", payer: "Aetna", amount: 892.50, method: "ERA", status: "ready", date: "05/19/2026" },
  { id: "pmt-3", source: "Patient – Dana Patel", patient: "Dana Patel", amount: 40.00, method: "Card", status: "posted", date: "05/19/2026" },
  { id: "pmt-4", source: "Patient – James Rivera", patient: "James Rivera", amount: 0.00, method: "Patient", status: "review", date: "05/18/2026", exception: "Copay collected: $0 — verify Medicare advantage plan" },
  { id: "pmt-5", source: "ERA #ERA-2026-0231", eraId: "ERA-2026-0231", payer: "Colorado Medicaid", amount: 2104.80, method: "ERA", status: "posted", date: "05/16/2026" },
  { id: "pmt-6", source: "Check #44821", amount: 618.00, method: "Check", status: "ready", date: "05/15/2026" },
  { id: "pmt-7", source: "ERA #ERA-2026-0229", eraId: "ERA-2026-0229", payer: "United Behavioral Health", amount: 330.00, method: "ERA", status: "exception", date: "05/14/2026", exception: "Unmatched claim — no matching claim found in system" },
  { id: "pmt-8", source: "Patient – Sofia Martinez", patient: "Sofia Martinez", amount: 0.00, method: "ACH", status: "review", date: "05/13/2026", exception: "ACH returned — insufficient funds" },
];

const LEDGER: LedgerLine[] = [
  { dos: "05/02", cpt: "90837", charge: 150.00, paid: 98.00, adj: 32.00, ptResp: 20.00, claimStatus: "paid" },
  { dos: "04/25", cpt: "90837", charge: 150.00, paid: 98.00, adj: 32.00, ptResp: 20.00, claimStatus: "paid" },
  { dos: "04/11", cpt: "90834", charge: 120.00, paid: 0.00, adj: 0.00, ptResp: 120.00, claimStatus: "patient" },
  { dos: "03/28", cpt: "90837", charge: 150.00, paid: 98.22, adj: 31.78, ptResp: 20.00, claimStatus: "paid" },
  { dos: "03/14", cpt: "90791", charge: 195.00, paid: 130.50, adj: 44.50, ptResp: 20.00, claimStatus: "paid" },
];

const TIMELINE = [
  { label: "Claim Submitted", date: "04/25/2026", dot: "dotBlue" },
  { label: "ERA Received from BCBS", date: "05/12/2026", dot: "dotGreen" },
  { label: "Payment Partially Applied", date: "05/19/2026", dot: "dotAmber" },
  { label: "Patient Balance Created – $20.00", date: "05/19/2026", dot: "dotBlue" },
  { label: "Statement Pending", date: "—", dot: "dotGray" },
];

const STATUS_LABELS: Record<PaymentStatus, string> = {
  ready: "Ready to Post",
  partial: "Partially Applied",
  exception: "Exception",
  review: "Needs Review",
  posted: "Posted",
};

const STATUS_CLASS: Record<PaymentStatus, string> = {
  ready: styles.qsReady,
  partial: styles.qsPartial,
  exception: styles.qsException,
  review: styles.qsReview,
  posted: styles.qsPosted,
};

type TabFilter = Record<QueueTab, boolean>;

function money(v: number) {
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function methodIcon(method: PaymentItem["method"]) {
  if (method === "ERA") return { cls: styles.queueRowIconEra, label: "ERA" };
  if (method === "Patient" || method === "Card") return { cls: styles.queueRowIconPatient, label: "$" };
  if (method === "Check") return { cls: styles.queueRowIconCheck, label: "CHK" };
  return { cls: styles.queueRowIconException, label: "!" };
}

export default function PaymentsClient() {
  const [tab, setTab] = useState<QueueTab>("all");
  const [selectedId, setSelectedId] = useState<string>("pmt-1");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = PAYMENTS;
    if (tab === "era") list = list.filter((p) => p.method === "ERA");
    if (tab === "patient") list = list.filter((p) => p.method === "Patient" || p.method === "Card" || p.method === "ACH");
    if (tab === "checks") list = list.filter((p) => p.method === "Check");
    if (tab === "unapplied") list = list.filter((p) => p.status === "ready" || p.status === "partial");
    if (tab === "exceptions") list = list.filter((p) => p.status === "exception" || p.status === "review");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) =>
        p.source.toLowerCase().includes(q) ||
        (p.payer ?? "").toLowerCase().includes(q) ||
        (p.patient ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [tab, search]);

  const selected = useMemo(() => PAYMENTS.find((p) => p.id === selectedId) ?? null, [selectedId]);

  const kpi = useMemo(() => ({
    postedToday: money(PAYMENTS.filter((p) => p.status === "posted").reduce((s, p) => s + p.amount, 0)),
    pendingEra: PAYMENTS.filter((p) => p.method === "ERA" && p.status !== "posted").length,
    unapplied: money(PAYMENTS.filter((p) => p.status === "ready" || p.status === "partial").reduce((s, p) => s + p.amount, 0)),
    patientPayments: money(PAYMENTS.filter((p) => p.method === "Patient" || p.method === "Card" || p.method === "ACH").reduce((s, p) => s + p.amount, 0)),
    refunds: 3,
    exceptions: PAYMENTS.filter((p) => p.status === "exception" || p.status === "review").length,
  }), []);

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <span className={styles.headerTitle}>Payments &amp; ERA</span>
        <div className={styles.headerSpacer} />
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </span>
          <input className={styles.searchInput} placeholder="Search ERA #, patient, payer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <input type="date" className={styles.dateInput} defaultValue={new Date().toISOString().slice(0, 10)} />
        <button type="button" className={styles.headerBtn}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Export
        </button>
        <button type="button" className={styles.headerBtn}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
          Import ERA
        </button>
        <button type="button" className={`${styles.headerBtn} ${styles.headerBtnPrimary}`}>
          + Post Payment
        </button>
      </header>

      {/* KPI Row */}
      <div className={styles.kpiRow}>
        <div className={styles.kpiCard}>
          <div className={`${styles.kpiValue} ${styles.kpiValueGreen}`}>{kpi.postedToday}</div>
          <div className={styles.kpiLabel}>Posted Today</div>
          <div className={`${styles.kpiTrend} ${styles.kpiTrendUp}`}>↑ 12% vs last week</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={`${styles.kpiValue} ${styles.kpiValueBlue}`}>{kpi.pendingEra}</div>
          <div className={styles.kpiLabel}>Pending ERAs</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={`${styles.kpiValue} ${styles.kpiValueAmber}`}>{kpi.unapplied}</div>
          <div className={styles.kpiLabel}>Unapplied Cash</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiValue}>{kpi.patientPayments}</div>
          <div className={styles.kpiLabel}>Patient Payments</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={styles.kpiValue}>{kpi.refunds}</div>
          <div className={styles.kpiLabel}>Refund Requests</div>
        </div>
        <div className={styles.kpiCard}>
          <div className={`${styles.kpiValue} ${styles.kpiValueRed}`}>{kpi.exceptions}</div>
          <div className={styles.kpiLabel}>Exceptions</div>
        </div>
      </div>

      {/* Body */}
      <div className={styles.body}>
        {/* Left Queue */}
        <div className={styles.queuePanel}>
          <div className={styles.queueTabs}>
            {(["all", "era", "patient", "checks", "unapplied", "exceptions"] as QueueTab[]).map((t) => (
              <button key={t} type="button" className={tab === t ? `${styles.queueTab} ${styles.queueTabActive}` : styles.queueTab} onClick={() => setTab(t)}>
                {t === "era" ? "ERA" : t === "unapplied" ? "Unapplied" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className={`${styles.queueList} text-[10px]`}>
            {filtered.map((pmt) => {
              const icon = methodIcon(pmt.method);
              return (
                <div
                  key={pmt.id}
                  className={`${styles.queueRow} ${selectedId === pmt.id ? styles.queueRowSelected : ""}`}
                  onClick={() => setSelectedId(pmt.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") setSelectedId(pmt.id); }}
                >
                  <div className={`${styles.queueRowIcon} ${icon.cls}`}>
                    <span style={{ fontSize: 11, fontWeight: 700 }}>{icon.label}</span>
                  </div>
                  <div className={styles.queueRowMain}>
                    <div className={styles.queueRowTop}>
                      <span className={styles.queueRowSource}>{pmt.source}</span>
                      <span className={styles.queueRowAmount}>{money(pmt.amount)}</span>
                    </div>
                    <div className={styles.queueRowMeta}>
                      {pmt.payer ?? pmt.patient ?? pmt.method}
                      <span>·</span>
                      <span>{pmt.date}</span>
                      <span className={`${styles.queueRowStatus} ${STATUS_CLASS[pmt.status]}`}>
                        {STATUS_LABELS[pmt.status]}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Detail */}
        <div className={styles.detailPanel}>
          {selected ? (
            <div className={styles.detailScroll}>
              {/* Payment Summary */}
              <div className={styles.paymentSummaryCard}>
                <div className={styles.paymentSummaryHeader}>
                  <div className={styles.paymentSummaryTitle}>{selected.source}</div>
                  <span className={`${styles.paymentSummaryBadge} ${STATUS_CLASS[selected.status]}`}>
                    {STATUS_LABELS[selected.status]}
                  </span>
                </div>
                <div className={styles.paymentSummaryMeta}>
                  <div className={styles.paymentSummaryField}>
                    <span className={styles.fieldLabel}>Amount</span>
                    <span className={styles.fieldValueLarge}>{money(selected.amount)}</span>
                  </div>
                  <div className={styles.paymentSummaryField}>
                    <span className={styles.fieldLabel}>Method</span>
                    <span className={styles.fieldValue}>{selected.method}</span>
                  </div>
                  <div className={styles.paymentSummaryField}>
                    <span className={styles.fieldLabel}>Received</span>
                    <span className={styles.fieldValue}>{selected.date}</span>
                  </div>
                  {selected.payer ? (
                    <div className={styles.paymentSummaryField}>
                      <span className={styles.fieldLabel}>Payer</span>
                      <span className={styles.fieldValue}>{selected.payer}</span>
                    </div>
                  ) : null}
                  {selected.patient ? (
                    <div className={styles.paymentSummaryField}>
                      <span className={styles.fieldLabel}>Patient</span>
                      <span className={styles.fieldValue}>{selected.patient}</span>
                    </div>
                  ) : null}
                  {selected.eraId ? (
                    <div className={styles.paymentSummaryField}>
                      <span className={styles.fieldLabel}>ERA #</span>
                      <span className={styles.fieldValue}>{selected.eraId}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Exception card if applicable */}
              {selected.exception ? (
                <div className={styles.exceptionCard}>
                  <span className={styles.exceptionIcon}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                  </span>
                  <div className={styles.exceptionBody}>
                    <div className={styles.exceptionText}>⚠ {selected.exception}</div>
                    <div className={styles.exceptionActions}>
                      <button type="button" className={styles.exceptionBtn}>Apply as Credit</button>
                      <button type="button" className={styles.exceptionBtn}>Refund</button>
                      <button type="button" className={styles.exceptionBtn}>Transfer</button>
                      <button type="button" className={styles.exceptionBtn}>Dismiss</button>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Ledger */}
              <div className={styles.sectionPanel}>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionTitle}>Payment Ledger</span>
                </div>
                <table className={styles.ledger}>
                  <thead>
                    <tr>
                      <th>DOS</th>
                      <th>CPT</th>
                      <th>Charge</th>
                      <th>Paid</th>
                      <th>Adj</th>
                      <th>Pt Resp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {LEDGER.map((row, i) => (
                      <tr key={i}>
                        <td className={styles.ledgerDos}>{row.dos}</td>
                        <td className={styles.ledgerCpt}>{row.cpt}</td>
                        <td>{row.charge.toFixed(2)}</td>
                        <td className={row.paid > 0 ? styles.ledgerPaid : styles.ledgerZero}>{row.paid > 0 ? row.paid.toFixed(2) : "0.00"}</td>
                        <td className={row.adj > 0 ? styles.ledgerAdj : styles.ledgerZero}>{row.adj > 0 ? row.adj.toFixed(2) : "—"}</td>
                        <td className={row.ptResp > 0 ? styles.ledgerPtResp : styles.ledgerZero}>{row.ptResp > 0 ? row.ptResp.toFixed(2) : "—"}</td>
                      </tr>
                    ))}
                    <tr style={{ background: "#F8FAFC" }}>
                      <td colSpan={2} style={{ fontWeight: 700, color: "#0F172A", fontSize: 12 }}>TOTAL</td>
                      <td style={{ fontWeight: 700, color: "#0F172A" }}>{LEDGER.reduce((s, r) => s + r.charge, 0).toFixed(2)}</td>
                      <td className={styles.ledgerPaid} style={{ fontWeight: 700 }}>{LEDGER.reduce((s, r) => s + r.paid, 0).toFixed(2)}</td>
                      <td className={styles.ledgerAdj}>{LEDGER.reduce((s, r) => s + r.adj, 0).toFixed(2)}</td>
                      <td className={styles.ledgerPtResp} style={{ fontWeight: 700 }}>{LEDGER.reduce((s, r) => s + r.ptResp, 0).toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Posting Actions */}
                <div className={styles.postingActions}>
                  <button type="button" className={`${styles.postBtn} ${styles.postBtnPrimary}`}>Post Payment</button>
                  <button type="button" className={styles.postBtn}>Split Payment</button>
                  <button type="button" className={styles.postBtn}>Transfer Balance</button>
                  <button type="button" className={styles.postBtn}>Write Off</button>
                  <button type="button" className={styles.postBtn}>Send to Patient Billing</button>
                  <button type="button" className={`${styles.postBtn} ${styles.postBtnRed}`}>Create Refund</button>
                </div>
              </div>

              {/* Financial Timeline */}
              <div className={styles.sectionPanel}>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionTitle}>Financial Timeline</span>
                </div>
                <div className={styles.timeline}>
                  {TIMELINE.map((item, i) => (
                    <div key={i} className={styles.timelineItem}>
                      <div className={`${styles.timelineDot} ${styles[item.dot as keyof typeof styles]}`}>✓</div>
                      <div className={styles.timelineContent}>
                        <div className={styles.timelineLabel}>{item.label}</div>
                        <div className={styles.timelineDate}>{item.date}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.detailEmpty}>
              <div className={styles.detailEmptyIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
              </div>
              <div className={styles.detailEmptyText}>Select a payment to view the ledger and post</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

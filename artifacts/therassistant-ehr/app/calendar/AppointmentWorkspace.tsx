"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DEFAULT_ORG_ID } from "@/lib/config";
import {
  Calendar,
  Clock,
  MapPin,
  User,
  FileText,
  Activity,
  ShieldCheck,
  CreditCard,
  ExternalLink,
  Video,
  CheckCircle2,
  Edit3,
  Navigation,
  X,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";

const ORG_ID =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ORGANIZATION_ID) ||
  DEFAULT_ORG_ID;

type AppointmentDetail = {
  appointment: {
    id: string;
    clientId: string | null;
    clientName: string;
    providerId: string | null;
    providerName: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    status: string;
    appointmentType: string | null;
    serviceLocation: string | null;
    cptCode: string | null;
    memo: string;
  };
  insurance: {
    primaryPolicy: {
      id: string;
      planName: string | null;
      policyNumber: string | null;
      priority: number | null;
      payerId: string | null;
      payerName: string | null;
      payerCode: string | null;
    } | null;
  };
  eligibility: {
    id: string;
    eligibility_status: string;
    checked_at: string;
    copay_amount: number;
    deductible_remaining: number;
    displayStatus: string;
    asOf: string | null;
  } | null;
  balance: { openBalance: number };
  encounter: { id: string; encounter_status: string } | null;
  clientDetails?: {
    dateOfBirth: string | null;
  } | null;
  authorization?: {
    status: string | null;
    authorizationNumber: string | null;
  } | null;
};

type WorkspaceCtx = {
  currentSessionNote: {
    encounterId: string;
    date: string | null;
    noteId: string | null;
    noteStatus: string | null;
    status: string | null;
  } | null;
  goals: Array<{ id: string; description: string; status: string }>;
  telehealth: { isVirtual: boolean; existingUrl: string | null };
};

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTimeRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const startStr = s.toLocaleTimeString(undefined, opts);
  const endStr = e.toLocaleTimeString(undefined, opts);
  const diffMin = Math.round((e.getTime() - s.getTime()) / 60000);
  return `${startStr} — ${endStr} (${diffMin} min)`;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function statusBadge(status: string) {
  const s = status.replace(/_/g, " ").toUpperCase();

  if (status === "checked_in" || status === "completed" || status === "in_progress") {
    return (
      <span className="px-2.5 py-1 text-xs font-bold tracking-wide bg-emerald-100 text-emerald-800 rounded-md flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
        {s}
      </span>
    );
  }

  if (status === "cancelled" || status === "no_show") {
    return (
      <span className="px-2.5 py-1 text-xs font-bold tracking-wide bg-red-100 text-red-800 rounded-md flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-red-600" />
        {s}
      </span>
    );
  }

  return (
    <span className="px-2.5 py-1 text-xs font-bold tracking-wide bg-slate-100 text-slate-800 rounded-md flex items-center gap-1.5">
      <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
      {s}
    </span>
  );
}

export default function AppointmentWorkspace({
  appointmentId,
  onClose,
  onRefresh,
  onCollect,
  onCancel,
  onOpenNext,
}: {
  appointmentId: string;
  onClose: () => void;
  onRefresh?: () => void;
  onCollect?: (data: {
    appointmentId: string;
    clientId: string | null;
    providerId: string | null;
    openBalance: number;
    clientName: string;
  }) => void;
  onCancel?: (data: {
    appointmentId: string;
    alreadyCancelled: boolean;
  }) => void;
  onOpenNext?: () => void;
}) {
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [workspaceCtx, setWorkspaceCtx] = useState<WorkspaceCtx | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    kind: "success" | "error" | "warning";
    text: string;
  } | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [chargeResult, setChargeResult] = useState<{
    chargeStatus: string | null;
    claimId: string | null;
  } | null>(null);
  const [telehealthLoading, setTelehealthLoading] = useState(false);
  const [joinUrl, setJoinUrl] = useState<string | null>(null);

  const workspaceRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const checkingInRef = useRef(false);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setBanner(null);

    try {
      const params = new URLSearchParams({ organizationId: ORG_ID });
      const res = await fetch(`/api/scheduling/appointments/${id}/detail?${params}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Failed to load appointment");
      }

      setDetail(json as AppointmentDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWorkspaceCtx = useCallback(async (id: string) => {
    try {
      const params = new URLSearchParams({ organizationId: ORG_ID });
      const res = await fetch(`/api/scheduling/appointments/${id}/workspace-context?${params}`);

      if (res.ok) {
        const json = await res.json();

        if (json.success) {
          setWorkspaceCtx(json as WorkspaceCtx);
        }
      }
    } catch {
      // Non-critical. Appointment workspace can load without context.
    }
  }, []);

  useEffect(() => {
    if (appointmentId) {
      void loadDetail(appointmentId);
      void loadWorkspaceCtx(appointmentId);
    }
  }, [appointmentId, loadDetail, loadWorkspaceCtx]);

  useEffect(() => {
    setChargeResult(null);
    setJoinUrl(null);
  }, [appointmentId]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    const timer = setTimeout(() => {
      const el = workspaceRef.current;

      if (el) {
        const focusable = focusableElements(el);
        if (focusable[0]) focusable[0].focus();
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      const previous = previousFocusRef.current;

      if (previous && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    function trapFocus(e: KeyboardEvent) {
      if (e.key !== "Tab" || !workspaceRef.current) return;

      const focusable = focusableElements(workspaceRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, []);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const handleOpenChart = useCallback(() => {
    if (detail?.appointment.clientId) {
      window.open(`/clients/${detail.appointment.clientId}`, "_blank", "noopener,noreferrer");
    }
  }, [detail]);

  const handleCheckIn = useCallback(async () => {
    if (!detail) return;
    if (checkingInRef.current) return;

    checkingInRef.current = true;
    setCheckingIn(true);
    setBanner(null);

    try {
      const res = await fetch("/api/encounters/create-from-appointment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: ORG_ID,
          appointmentId: detail.appointment.id,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error ?? "Could not start encounter");
      }

      if (json.encounterId) {
        setBanner({
          kind: "success",
          text: "Encounter created. Open the chart to complete the clinical note.",
        });

        await loadDetail(detail.appointment.id);
        await loadWorkspaceCtx(detail.appointment.id);
        onRefresh?.();
      } else {
        setBanner({ kind: "error", text: "No encounter returned." });
      }
    } catch (e) {
      setBanner({
        kind: "error",
        text: e instanceof Error ? e.message : "Could not start encounter",
      });
    } finally {
      checkingInRef.current = false;
      setCheckingIn(false);
    }
  }, [detail, loadDetail, loadWorkspaceCtx, onRefresh]);

  const handleTelehealth = useCallback(async () => {
    if (!detail) return;

    if (joinUrl) {
      window.open(joinUrl, "_blank");
      return;
    }

    setTelehealthLoading(true);
    setBanner(null);

    try {
      const res = await fetch(`/api/telehealth/appointments/${detail.appointment.id}/join`, {
        method: "POST",
      });
      const json = await res.json();

      if (res.ok && json.success) {
        const url: string | null = json.hostUrl || json.joinUrl || null;

        if (url) {
          setJoinUrl(url);
          window.open(url, "_blank");

          try {
            await navigator.clipboard.writeText(url);
          } catch {
            // Ignore clipboard failure.
          }

          setBanner({
            kind: "success",
            text: "Telehealth session started — link copied to clipboard.",
          });
        } else {
          setBanner({ kind: "error", text: "Session created but no link returned." });
        }
      } else {
        setBanner({
          kind: "error",
          text: json.error ?? "Could not start telehealth session",
        });
      }
    } catch (e) {
      setBanner({
        kind: "error",
        text: e instanceof Error ? e.message : "Telehealth unavailable",
      });
    } finally {
      setTelehealthLoading(false);
    }
  }, [detail, joinUrl]);

  const actionMeta = useMemo(() => {
    if (!detail) return null;

    const { status, providerId } = detail.appointment;
    const alreadyCheckedIn =
      status === "checked_in" || status === "in_progress" || status === "completed";
    const isCancelled = status === "cancelled";
    const isNoShow = status === "no_show";
    const hasProvider = !!providerId;
    const hasEncounter = !!detail.encounter;
    const eligible = detail.eligibility;
    const eligibilityWarning =
      eligible?.displayStatus === "stale" ||
      eligible?.displayStatus === "not_checked" ||
      eligible?.displayStatus === "unknown";
    const authWarning =
      !detail.authorization?.status || detail.authorization?.status === "not_checked";

    return {
      alreadyCheckedIn,
      isCancelled,
      isNoShow,
      hasProvider,
      hasEncounter,
      eligibilityWarning,
      authWarning,
      canCheckIn: !alreadyCheckedIn && !isCancelled && !isNoShow && hasProvider,
      canCancel: !isCancelled && !alreadyCheckedIn,
      canReschedule: !isCancelled && !alreadyCheckedIn,
    };
  }, [detail]);

  if (loading || !detail) {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/40 flex justify-end"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="dialog"
        aria-modal="true"
      >
        <div
          ref={workspaceRef}
          className="w-full max-w-[720px] h-full bg-[#f9fafc] flex flex-col animate-pulse"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-start p-6 bg-white border-b border-slate-200">
            <div className="space-y-3">
              <div className="h-8 w-48 bg-slate-200 rounded" />
              <div className="flex items-center gap-2">
                <div className="h-6 w-24 bg-slate-200 rounded-md" />
                <div className="h-6 w-28 bg-slate-200 rounded-md" />
              </div>
            </div>
            <div className="space-y-2 text-right">
              <div className="h-5 w-32 bg-slate-200 rounded ml-auto" />
              <div className="h-4 w-40 bg-slate-200 rounded ml-auto" />
              <div className="h-4 w-36 bg-slate-200 rounded ml-auto" />
            </div>
          </div>

          <div className="p-6 flex-1 flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="flex flex-col gap-6">
                <div className="h-72 bg-slate-200 rounded-xl" />
                <div className="h-56 bg-slate-200 rounded-xl" />
                <div className="h-48 bg-slate-200 rounded-xl" />
              </div>
              <div className="flex flex-col gap-6">
                <div className="h-96 bg-slate-200 rounded-xl" />
              </div>
            </div>
            <div className="h-24 bg-slate-200 rounded-xl" />
            <div className="h-24 bg-slate-200 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/40 flex justify-end"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="dialog"
        aria-modal="true"
      >
        <div
          ref={workspaceRef}
          className="w-full max-w-[720px] h-full bg-[#f9fafc] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center p-6 bg-white border-b border-slate-200">
            <h2 className="text-xl font-bold text-slate-900">Appointment</h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Close"
              type="button"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-md text-center">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <h2 className="text-lg font-bold text-slate-900 mb-2">
                Unable to load workspace
              </h2>
              <p className="text-sm text-slate-600">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const {
    appointment,
    insurance,
    eligibility,
    balance,
    encounter,
    clientDetails,
    authorization,
  } = detail;
  const meta = actionMeta;
  const noteExists = !!workspaceCtx?.currentSessionNote || !!encounter;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-title"
    >
      <div
        ref={workspaceRef}
        className="w-full max-w-[720px] h-full bg-[#f9fafc] text-slate-800 font-sans flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start p-6 bg-white border-b border-slate-200 shrink-0">
          <div>
            <h1
              id="workspace-title"
              className="text-2xl font-bold text-slate-900 flex items-center gap-2"
            >
              {appointment.clientName}
            </h1>
            <div className="flex items-center gap-2 mt-3">
              {statusBadge(appointment.status)}
              {encounter ? (
                <span className="px-2.5 py-1 text-xs font-bold tracking-wide bg-amber-100 text-amber-800 rounded-md flex items-center gap-1.5">
                  <Edit3 className="w-3 h-3" />
                  NOTE: {encounter.encounter_status.replace(/_/g, " ").toUpperCase()}
                </span>
              ) : null}
            </div>
          </div>

          <div className="text-right">
            <div className="text-slate-800 font-semibold text-base flex items-center justify-end gap-1.5">
              <Calendar className="w-4 h-4 text-slate-400" />
              {fmtDate(appointment.scheduledStartAt)}
            </div>
            <div className="text-slate-500 text-sm mt-1 flex items-center justify-end gap-1.5">
              <Clock className="w-4 h-4 text-slate-400" />
              {fmtTimeRange(appointment.scheduledStartAt, appointment.scheduledEndAt)}
            </div>
            <div className="text-slate-500 text-sm mt-1.5 font-medium flex items-center justify-end gap-1.5">
              <User className="w-4 h-4 text-slate-400" />
              {appointment.providerName}
            </div>
          </div>

          <button
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
            onClick={onClose}
            aria-label="Close workspace"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {banner ? (
          <div
            className={`px-6 py-2 text-sm font-medium shrink-0 ${
              banner.kind === "success"
                ? "bg-emerald-50 text-emerald-800 border-b border-emerald-100"
                : banner.kind === "warning"
                  ? "bg-amber-50 text-amber-800 border-b border-amber-100"
                  : "bg-red-50 text-red-800 border-b border-red-100"
            }`}
          >
            {banner.text}
          </div>
        ) : null}

        <div className="p-6 flex-1 overflow-y-auto flex flex-col gap-6">
          {meta?.eligibilityWarning ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Eligibility is {eligibility?.displayStatus ?? "not checked"}. Check-in allowed.
            </div>
          ) : null}

          {meta?.authWarning ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              No authorization on file. Check-in allowed.
            </div>
          ) : null}

          {!meta?.hasProvider && appointment.cptCode ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              No provider assigned — check-in disabled for billable appointment.
            </div>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex flex-col gap-6">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Visit Details
                </h2>

                <div className="space-y-3.5 text-sm">
                  <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                    <span className="text-slate-500 font-medium">Date of Birth</span>
                    <span className="font-semibold text-slate-800">
                      {clientDetails?.dateOfBirth
                        ? new Date(clientDetails.dateOfBirth).toLocaleDateString()
                        : "—"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                    <span className="text-slate-500 font-medium">Visit Type</span>
                    <span className="font-semibold text-slate-800">
                      {appointment.appointmentType ?? "—"}{" "}
                      {appointment.cptCode ? (
                        <span className="text-slate-400 font-normal">
                          ({appointment.cptCode})
                        </span>
                      ) : null}
                    </span>
                  </div>

                  <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                    <span className="text-slate-500 font-medium">Location</span>
                    <span className="font-semibold text-slate-800 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      {appointment.serviceLocation ?? "—"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                    <span className="text-slate-500 font-medium">Clinician</span>
                    <span className="font-semibold text-slate-800">
                      {appointment.providerName || "—"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                    <span className="text-slate-500 font-medium">Balance</span>
                    <span className="font-semibold text-slate-800">
                      {money(balance.openBalance)} open
                    </span>
                  </div>

                  {appointment.memo ? (
                    <div className="pt-1">
                      <span className="text-slate-500 font-medium block mb-1.5">Memo</span>
                      <div className="text-slate-700 bg-amber-50/50 border border-amber-100 p-3 rounded-lg text-sm italic">
                        &ldquo;{appointment.memo}&rdquo;
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <Activity className="w-4 h-4" /> Quick Actions
                </h2>

                <div className="grid grid-cols-2 gap-2.5">
                  {noteExists || meta?.alreadyCheckedIn ? (
                    <button
                      className="col-span-2 py-2.5 bg-[#2c6cf6] text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                      type="button"
                      onClick={handleOpenChart}
                      disabled={!appointment.clientId}
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open Chart to Edit Note
                    </button>
                  ) : (
                    <button
                      className="col-span-2 py-2.5 bg-[#2c6cf6] text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                      type="button"
                      onClick={handleCheckIn}
                      disabled={checkingIn || !meta?.canCheckIn}
                      aria-busy={checkingIn || undefined}
                      title={
                        !meta?.hasProvider && appointment.cptCode
                          ? "Assign a provider before checking in"
                          : meta?.isCancelled || meta?.isNoShow
                            ? "Cannot check in cancelled/no-show appointment"
                            : undefined
                      }
                    >
                      {checkingIn ? (
                        <>
                          <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Checking in…
                        </>
                      ) : (
                        <>
                          <Edit3 className="w-4 h-4" /> Check In / Start Encounter
                        </>
                      )}
                    </button>
                  )}

                  {workspaceCtx?.telehealth?.isVirtual ? (
                    <button
                      className="col-span-2 py-2.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-lg text-sm font-semibold hover:bg-sky-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                      type="button"
                      onClick={handleTelehealth}
                      disabled={telehealthLoading}
                    >
                      {telehealthLoading ? (
                        <>
                          <span className="inline-block w-4 h-4 border-2 border-sky-300 border-t-sky-700 rounded-full animate-spin" />
                          Starting…
                        </>
                      ) : joinUrl ? (
                        <>
                          <Video className="w-4 h-4" /> Rejoin Telehealth
                        </>
                      ) : (
                        <>
                          <Video className="w-4 h-4" /> Start Telehealth
                        </>
                      )}
                    </button>
                  ) : null}

                  {appointment.clientId ? (
                    <Link
                      href={`/clients/${appointment.clientId}`}
                      className="py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors flex items-center justify-center gap-1"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Open Chart
                    </Link>
                  ) : (
                    <button
                      className="py-2 bg-white border border-slate-200 text-slate-400 rounded-lg text-sm font-medium cursor-not-allowed"
                      disabled
                    >
                      Open Chart
                    </button>
                  )}

                  {appointment.clientId && onCollect ? (
                    <button
                      className="py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                      type="button"
                      onClick={() => {
                        onCollect({
                          appointmentId: appointment.id,
                          clientId: appointment.clientId,
                          providerId: appointment.providerId,
                          openBalance: balance.openBalance,
                          clientName: appointment.clientName,
                        });
                      }}
                    >
                      Collect Copay
                    </button>
                  ) : (
                    <button
                      className="py-2 bg-white border border-slate-200 text-slate-400 rounded-lg text-sm font-medium cursor-not-allowed"
                      disabled
                    >
                      Collect Copay
                    </button>
                  )}

                  {meta?.canReschedule ? (
                    <button
                      className="py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
                      type="button"
                      onClick={() => {
                        setBanner({
                          kind: "error",
                          text: "Reschedule flow via schedule page — not yet wired",
                        });
                      }}
                    >
                      Reschedule
                    </button>
                  ) : (
                    <button
                      className="py-2 bg-white border border-slate-200 text-slate-400 rounded-lg text-sm font-medium cursor-not-allowed"
                      disabled
                    >
                      Reschedule
                    </button>
                  )}

                  {meta?.canCancel && onCancel ? (
                    <button
                      className="py-2 bg-white border border-slate-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
                      type="button"
                      onClick={() => {
                        onCancel({
                          appointmentId: appointment.id,
                          alreadyCancelled: appointment.status === "cancelled",
                        });
                      }}
                    >
                      Cancel Visit
                    </button>
                  ) : (
                    <button
                      className="py-2 bg-white border border-slate-200 text-slate-400 rounded-lg text-sm font-medium cursor-not-allowed"
                      disabled
                    >
                      Cancel Visit
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" /> Insurance & Billing
                </h2>

                <div className="space-y-3.5 text-sm">
                  <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                    <span className="text-slate-500 font-medium">Primary Payer</span>
                    <span className="font-semibold text-slate-800">
                      {insurance.primaryPolicy?.payerName ?? "Unknown payer"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                    <span className="text-slate-500 font-medium">Plan</span>
                    <span className="font-semibold text-slate-800">
                      {insurance.primaryPolicy?.planName ?? "—"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                    <span className="text-slate-500 font-medium">Eligibility</span>
                    {eligibility ? (
                      <span
                        className={`font-bold px-2.5 py-0.5 rounded-md text-xs border flex items-center gap-1 ${
                          eligibility.displayStatus === "active"
                            ? "text-emerald-700 bg-emerald-50 border-emerald-100"
                            : eligibility.displayStatus === "inactive"
                              ? "text-red-700 bg-red-50 border-red-100"
                              : "text-amber-700 bg-amber-50 border-amber-100"
                        }`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {eligibility.displayStatus === "active"
                          ? "ACTIVE"
                          : eligibility.displayStatus === "inactive"
                            ? "INACTIVE"
                            : eligibility.displayStatus === "stale"
                              ? "STALE"
                              : eligibility.displayStatus === "unknown"
                                ? "UNKNOWN"
                                : "NOT CHECKED"}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>

                  <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                    <span className="text-slate-500 font-medium">Copay</span>
                    <span className="font-bold text-slate-800 flex items-center gap-1">
                      <CreditCard className="w-4 h-4 text-slate-400" />
                      {eligibility?.copay_amount != null ? money(eligibility.copay_amount) : "—"}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Auth</span>
                    <span className="font-mono text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded">
                      {authorization?.authorizationNumber ?? "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex-1 flex flex-col">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Clinical Note
                  </h2>

                  {workspaceCtx?.currentSessionNote?.noteStatus ? (
                    <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                      {workspaceCtx.currentSessionNote.noteStatus
                        .replace(/_/g, " ")
                        .toUpperCase()}
                    </span>
                  ) : encounter ? (
                    <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                      {encounter.encounter_status.replace(/_/g, " ").toUpperCase()}
                    </span>
                  ) : null}
                </div>

                {noteExists ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center border border-dashed border-slate-200 rounded-xl bg-slate-50 p-6">
                    <FileText className="w-8 h-8 text-slate-300 mb-3" />
                    <p className="text-sm font-semibold text-slate-700">
                      Clinical note already exists
                    </p>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs">
                      Existing or completed notes are not shown in the appointment workspace.
                      Open the client chart to review or edit the note.
                    </p>

                    {appointment.clientId ? (
                      <button
                        type="button"
                        onClick={handleOpenChart}
                        className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-[#2c6cf6] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Open Chart
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center border border-dashed border-slate-200 rounded-xl bg-slate-50 p-6">
                    <FileText className="w-8 h-8 text-slate-300 mb-3" />
                    <p className="text-sm font-semibold text-slate-700">
                      No clinical note yet
                    </p>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs">
                      Check in to create the encounter. The appointment workspace does not
                      display completed note content.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {workspaceCtx?.goals && workspaceCtx.goals.length > 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Navigation className="w-4 h-4" /> Treatment Plan Goals
              </h2>

              <div className="flex flex-wrap gap-2.5">
                {workspaceCtx.goals.map((goal) => (
                  <div
                    key={goal.id}
                    className="bg-blue-50/50 border border-blue-100 text-blue-800 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    {goal.description}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {chargeResult ? (
            <div className="bg-[#f0fdf4] rounded-xl border border-[#bbf7d0] shadow-sm p-5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-[#15803d] mb-1 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  {chargeResult.chargeStatus === "patient_responsibility"
                    ? "Patient Responsibility"
                    : chargeResult.chargeStatus === "blocked"
                      ? "Charge Blocked"
                      : chargeResult.chargeStatus === "ready_for_claim" || chargeResult.claimId
                        ? "Visit Documentation Complete"
                        : "Note Signed"}
                </h2>
                <p className="text-[#166534] text-sm font-medium">
                  {chargeResult.claimId ? (
                    <>
                      Claim{" "}
                      <span className="font-mono bg-white/60 px-1 py-0.5 rounded">
                        {chargeResult.claimId}
                      </span>{" "}
                      is ready for submission.
                    </>
                  ) : (
                    "Visit documentation complete."
                  )}
                </p>
              </div>

              <div className="flex gap-3">
                {chargeResult.claimId ? (
                  <a
                    href={`/billing/claims/${chargeResult.claimId}?organizationId=${encodeURIComponent(
                      ORG_ID,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 text-sm font-bold text-[#15803d] bg-white border border-[#bbf7d0] rounded-lg hover:bg-emerald-50 transition-colors flex items-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4" /> View Claim
                  </a>
                ) : null}

                {onOpenNext ? (
                  <button
                    className="px-5 py-2 text-sm font-bold text-white bg-[#2c6cf6] rounded-lg hover:bg-blue-700 shadow-md transition-colors flex items-center gap-2"
                    type="button"
                    onClick={onOpenNext}
                  >
                    Open Next <ArrowRight className="w-4 h-4" />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
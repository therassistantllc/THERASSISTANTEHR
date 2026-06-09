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
  ChevronRight,
  Edit3,
  Navigation,
} from "lucide-react";
import type { WorkspaceData } from "@/hooks/useWorkspaceData";

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
  return `${startStr} \u2014 ${endStr} (${diffMin} min)`;
}

function statusBadge(status: string) {
  const s = status.replace(/_/g, " ").toUpperCase();
  if (status === "checked_in" || status === "completed") {
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

export function CardGridDashboard({ data }: { data: WorkspaceData }) {
  const {
    appointment,
    insurance,
    eligibility,
    encounter,
    clientDetails,
    authorization,
    currentSessionNote,
    goals,
    chargeResult,
  } = data;

  return (
    <div className="w-full min-h-screen bg-[#f9fafc] text-slate-800 font-sans flex flex-col">
      {/* Header Area */}
      <div className="flex justify-between items-start p-6 bg-white border-b border-slate-200 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            {appointment.clientName}
          </h1>
          <div className="flex items-center gap-2 mt-3">
            {statusBadge(appointment.status)}
            <span className="px-2.5 py-1 text-xs font-bold tracking-wide bg-amber-100 text-amber-800 rounded-md flex items-center gap-1.5">
              <Edit3 className="w-3 h-3" />
              NOTE: {encounter.encounter_status.replace(/_/g, " ").toUpperCase()}
            </span>
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
      </div>

      {/* Scrollable Workspace Body */}
      <div className="p-6 flex-1 overflow-y-auto flex flex-col gap-6">
        {/* 2-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT COLUMN */}
          <div className="flex flex-col gap-6">
            {/* Card 1: Visit Details */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4" /> Visit Details
              </h2>
              <div className="space-y-3.5 text-sm">
                <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                  <span className="text-slate-500 font-medium">Date of Birth</span>
                  <span className="font-semibold text-slate-800">{clientDetails.dateOfBirth}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                  <span className="text-slate-500 font-medium">Visit Type</span>
                  <span className="font-semibold text-slate-800">
                    {appointment.appointmentType}{" "}
                    <span className="text-slate-400 font-normal">({appointment.cptCode})</span>
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                  <span className="text-slate-500 font-medium">Location</span>
                  <span className="font-semibold text-slate-800 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    {appointment.serviceLocation}
                  </span>
                </div>
                <div className="pt-1">
                  <span className="text-slate-500 font-medium block mb-1.5">Memo</span>
                  <div className="text-slate-700 bg-amber-50/50 border border-amber-100 p-3 rounded-lg text-sm italic">
                    &ldquo;{appointment.memo}&rdquo;
                  </div>
                </div>
              </div>
            </div>

            {/* Card 3: Quick Actions */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4" /> Quick Actions
              </h2>
              <div className="grid grid-cols-2 gap-2.5">
                <button className="col-span-2 py-2.5 bg-[#2c6cf6] text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-sm">
                  <Edit3 className="w-4 h-4" /> Open Note
                </button>
                <button className="col-span-2 py-2.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-lg text-sm font-semibold hover:bg-sky-100 transition-colors flex items-center justify-center gap-2">
                  <Video className="w-4 h-4" /> Start Telehealth
                </button>
                <button className="py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                  Collect Copay
                </button>
                <button className="py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                  Open Chart
                </button>
                <button className="py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
                  Reschedule
                </button>
                <button className="py-2 bg-white border border-slate-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors">
                  Cancel Visit
                </button>
              </div>
            </div>

            {/* Card 4: Insurance & Billing */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Insurance & Billing
              </h2>
              <div className="space-y-3.5 text-sm">
                <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                  <span className="text-slate-500 font-medium">Primary Payer</span>
                  <span className="font-semibold text-slate-800">{insurance.primaryPolicy.payerName}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                  <span className="text-slate-500 font-medium">Plan</span>
                  <span className="font-semibold text-slate-800">{insurance.primaryPolicy.planName}</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                  <span className="text-slate-500 font-medium">Eligibility</span>
                  <span className="font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md text-xs border border-emerald-100 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> ACTIVE
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-50 pb-2.5">
                  <span className="text-slate-500 font-medium">Copay</span>
                  <span className="font-bold text-slate-800 flex items-center gap-1">
                    <CreditCard className="w-4 h-4 text-slate-400" />${eligibility.copay_amount}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Auth</span>
                  <span className="font-mono text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded">
                    {authorization.authorizationNumber}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="flex flex-col gap-6">
            {/* Card 2: Session Note */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex-1 flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Session Note
                </h2>
                <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                  IN PROGRESS
                </span>
              </div>

              <div className="space-y-4 text-sm flex-1">
                <div>
                  <h3 className="font-bold text-slate-800 mb-1.5 text-xs tracking-wide">SUBJECTIVE</h3>
                  <div className="text-slate-700 bg-slate-50 border border-slate-100 p-3 rounded-lg leading-relaxed shadow-inner">
                    {currentSessionNote.subjective}
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 mb-1.5 text-xs tracking-wide">OBJECTIVE</h3>
                  <div className="text-slate-700 bg-slate-50 border border-slate-100 p-3 rounded-lg leading-relaxed shadow-inner">
                    {currentSessionNote.objective}
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 mb-1.5 text-xs tracking-wide">ASSESSMENT</h3>
                  <div className="text-slate-700 bg-slate-50 border border-slate-100 p-3 rounded-lg leading-relaxed shadow-inner">
                    {currentSessionNote.assessment}
                  </div>
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 mb-1.5 text-xs tracking-wide">PLAN</h3>
                  <div className="text-slate-700 bg-slate-50 border border-slate-100 p-3 rounded-lg leading-relaxed shadow-inner">
                    {currentSessionNote.plan}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* FULL WIDTH PANELS BELOW GRID */}

        {/* Card 5: Active Goals */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Navigation className="w-4 h-4" /> Treatment Plan Goals
          </h2>
          <div className="flex flex-wrap gap-2.5">
            {goals.map((g) => (
              <div
                key={g.id}
                className="bg-blue-50/50 border border-blue-100 text-blue-800 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                {g.description}
              </div>
            ))}
          </div>
        </div>

        {/* Card 6: Charge Result */}
        <div className="bg-[#f0fdf4] rounded-xl border border-[#bbf7d0] shadow-sm p-5 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[#15803d] mb-1 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" /> Visit Documentation Complete
            </h2>
            <p className="text-[#166534] text-sm font-medium">
              Claim <span className="font-mono bg-white/60 px-1 py-0.5 rounded">{chargeResult.claimId}</span> is ready for submission upon signing.
            </p>
          </div>
          <div className="flex gap-3">
            <button className="px-4 py-2 text-sm font-bold text-[#15803d] bg-white border border-[#bbf7d0] rounded-lg hover:bg-emerald-50 transition-colors flex items-center gap-2">
              <ExternalLink className="w-4 h-4" /> View Claim
            </button>
            <button className="px-5 py-2 text-sm font-bold text-white bg-[#2c6cf6] rounded-lg hover:bg-blue-700 shadow-md transition-colors flex items-center gap-2">
              Sign & Open Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

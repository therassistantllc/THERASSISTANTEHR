import React from "react";
import { 
  APPOINTMENTS, 
  SUMMARY, 
  DATE_LABEL, 
  type ScheduleAppointment 
} from "./_data";
import { 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  FileEdit, 
  FileText, 
  MessageSquare, 
  Phone, 
  User, 
  Video, 
  Activity,
  ArrowRight,
  MoreHorizontal,
  Calendar,
  AlertTriangle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Categorize appointments based on the "Action Triage" hypothesis
const getRightNow = () => APPOINTMENTS.filter(a => a.status === "in_session" || a.status === "checked_in");
const getActionRequired = () => APPOINTMENTS.filter(a => 
  (a.status === "needs_signature" || a.status === "no_show" || a.alerts.some(al => al.tone === "red" || al.tone === "amber")) && 
  a.status !== "in_session" && a.status !== "checked_in"
);
const getComingUp = () => APPOINTMENTS.filter(a => 
  a.status === "scheduled" && !getActionRequired().includes(a)
);
const getClosedOut = () => APPOINTMENTS.filter(a => 
  a.status === "completed" || a.status === "cancelled"
);

function TaskItem({ text, priority, type = "task" }: { text: string; priority?: string; type?: "task" | "alert" | "note" }) {
  const getColors = () => {
    if (type === "alert") {
      if (priority === "red") return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50";
      if (priority === "amber") return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50";
      if (priority === "blue") return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/50";
      if (priority === "purple") return "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-900/50";
      return "bg-slate-50 text-slate-700 border-slate-200";
    }
    if (priority === "high") return "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-900/50";
    if (priority === "med") return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/50";
    return "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800";
  };

  const Icon = type === "alert" ? AlertTriangle : type === "note" ? FileText : CheckCircle2;

  return (
    <div className={cn("flex items-start gap-2 text-sm px-2.5 py-1.5 rounded-md border", getColors())}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0 opacity-70" />
      <span className="leading-snug font-medium">{text}</span>
    </div>
  );
}

function TriageCard({ appt, primaryAction, secondaryAction }: { appt: ScheduleAppointment, primaryAction: string, secondaryAction?: string }) {
  const isActionRequired = appt.status === "needs_signature" || appt.status === "no_show" || appt.alerts.some(a => a.tone === "red" || a.tone === "amber");
  
  return (
    <div className={cn(
      "group relative flex flex-col sm:flex-row gap-4 p-4 sm:p-5 rounded-xl border transition-all duration-200 bg-white dark:bg-slate-950",
      isActionRequired ? "border-slate-300 dark:border-slate-700 shadow-sm" : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
    )}>
      {/* Time & Meta (Left Column) */}
      <div className="w-full sm:w-32 shrink-0 flex flex-row sm:flex-col gap-2 sm:gap-1 text-slate-500">
        <div className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
          {appt.timeStart}
        </div>
        <div className="text-xs font-medium flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          {appt.durationMin}m
        </div>
        <div className="text-xs font-medium flex items-center gap-1.5 sm:mt-2">
          {appt.location === "Telehealth" ? <Video className="w-3.5 h-3.5 text-blue-500" /> : <User className="w-3.5 h-3.5 text-emerald-600" />}
          {appt.location}
        </div>
        <div className="hidden sm:inline-flex mt-auto pt-2">
          <Badge variant="outline" className="text-[10px] font-mono uppercase bg-slate-50 dark:bg-slate-900 text-slate-500 border-slate-200">{appt.cpt}</Badge>
        </div>
      </div>

      {/* Main Content (Center Column) */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              {appt.patientName}
              <span className="text-xs font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                DOB: {appt.dob.split('-')[0]}
              </span>
            </h3>
            <div className="text-sm font-medium text-slate-600 dark:text-slate-400 mt-0.5">
              {appt.type} • {appt.provider}
            </div>
          </div>
          <Badge 
            variant="secondary" 
            className={cn(
              "capitalize text-xs font-bold tracking-wide",
              appt.status === "in_session" && "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400",
              appt.status === "checked_in" && "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400",
              appt.status === "needs_signature" && "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400",
              appt.status === "no_show" && "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
            )}
          >
            {appt.status.replace("_", " ")}
          </Badge>
        </div>

        {/* Alerts & Tasks Queue */}
        {(appt.alerts.length > 0 || appt.tasks.length > 0) && (
          <div className="flex flex-col gap-2 mt-1">
            {appt.alerts.map((a, i) => (
              <TaskItem key={`alert-${i}`} text={a.text} priority={a.tone} type="alert" />
            ))}
            {appt.tasks.map((t, i) => (
              <TaskItem key={`task-${i}`} text={t.text} priority={t.priority} type="task" />
            ))}
          </div>
        )}
      </div>

      {/* Actions (Right Column) */}
      <div className="w-full sm:w-40 shrink-0 flex sm:flex-col justify-end sm:justify-start gap-2 pt-2 sm:pt-0 sm:pl-4 sm:border-l border-slate-100 dark:border-slate-800">
        <Button 
          className={cn(
            "w-full justify-between shadow-none",
            isActionRequired ? "bg-slate-900 hover:bg-slate-800 text-white" : "bg-white hover:bg-slate-50 text-slate-900 border border-slate-200"
          )}
          variant={isActionRequired ? "default" : "outline"}
        >
          {primaryAction}
          <ArrowRight className="w-4 h-4 opacity-50" />
        </Button>
        {secondaryAction && (
          <Button variant="ghost" className="w-full justify-between text-slate-500 hover:text-slate-900 h-9 hidden sm:flex">
            {secondaryAction}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="sm:hidden text-slate-500">
          <MoreHorizontal className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}

export function ActionTriageQueue() {
  const rightNow = getRightNow();
  const actionRequired = getActionRequired();
  const comingUp = getComingUp();
  const closedOut = getClosedOut();

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 font-sans text-slate-900">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        .font-sans { font-family: 'Inter', sans-serif; }
      `}} />

      {/* Sticky Header */}
      <header className="sticky top-0 z-20 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">Triage Queue</h1>
            <p className="text-sm font-medium text-slate-500 flex items-center gap-2 mt-1">
              <Calendar className="w-4 h-4" />
              {DATE_LABEL}
            </p>
          </div>
          
          <div className="flex items-center gap-3 overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
            <div className="flex flex-col items-center justify-center px-4 py-1.5 bg-slate-100 dark:bg-slate-900 rounded-lg min-w-[80px]">
              <span className="text-2xl font-bold leading-none">{SUMMARY.total}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-1">Total</span>
            </div>
            <div className="flex flex-col items-center justify-center px-4 py-1.5 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-500 rounded-lg min-w-[80px] border border-amber-100 dark:border-amber-900/50">
              <span className="text-2xl font-bold leading-none">{SUMMARY.unsigned}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-80 mt-1">Unsigned</span>
            </div>
            <div className="flex flex-col items-center justify-center px-4 py-1.5 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-500 rounded-lg min-w-[80px] border border-red-100 dark:border-red-900/50">
              <span className="text-2xl font-bold leading-none">{SUMMARY.noShow}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-80 mt-1">No Show</span>
            </div>
            <div className="flex flex-col items-center justify-center px-4 py-1.5 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-500 rounded-lg min-w-[80px] border border-blue-100 dark:border-blue-900/50">
              <span className="text-2xl font-bold leading-none">{SUMMARY.messages}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-80 mt-1">Msgs</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-10">

        {/* RIGHT NOW */}
        {rightNow.length > 0 && (
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Right Now</h2>
              <Badge variant="secondary" className="bg-slate-200 dark:bg-slate-800 text-slate-600 rounded-full px-2">{rightNow.length}</Badge>
            </div>
            <div className="flex flex-col gap-3">
              {rightNow.map(appt => (
                <TriageCard 
                  key={appt.id} 
                  appt={appt} 
                  primaryAction={appt.status === "in_session" ? "Open Chart" : "Start Session"} 
                  secondaryAction="Quick Note"
                />
              ))}
            </div>
          </section>
        )}

        {/* ACTION REQUIRED */}
        {actionRequired.length > 0 && (
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
            <div className="flex items-center gap-3 mb-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Action Required</h2>
              <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-500 rounded-full px-2">{actionRequired.length}</Badge>
            </div>
            <div className="flex flex-col gap-3">
              {actionRequired.map(appt => (
                <TriageCard 
                  key={appt.id} 
                  appt={appt} 
                  primaryAction={appt.status === "needs_signature" ? "Sign Note" : appt.status === "no_show" ? "Process No-Show" : "Resolve Alerts"} 
                  secondaryAction="View Details"
                />
              ))}
            </div>
          </section>
        )}

        {/* COMING UP */}
        {comingUp.length > 0 && (
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
            <div className="flex items-center gap-3 mb-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <Clock className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Coming Up</h2>
              <Badge variant="secondary" className="bg-slate-200 dark:bg-slate-800 text-slate-600 rounded-full px-2">{comingUp.length}</Badge>
            </div>
            <div className="flex flex-col gap-3">
              {comingUp.map(appt => (
                <TriageCard 
                  key={appt.id} 
                  appt={appt} 
                  primaryAction="Review Chart" 
                  secondaryAction="Reschedule"
                />
              ))}
            </div>
          </section>
        )}

        {/* CLOSED OUT */}
        {closedOut.length > 0 && (
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300 opacity-60 hover:opacity-100 transition-opacity">
            <div className="flex items-center gap-3 mb-4 pt-4 border-t border-slate-200 dark:border-slate-800">
              <CheckCircle2 className="w-5 h-5 text-slate-400" />
              <h2 className="text-lg font-bold text-slate-500 dark:text-slate-400">Closed Out</h2>
              <Badge variant="secondary" className="bg-slate-200 dark:bg-slate-800 text-slate-500 rounded-full px-2">{closedOut.length}</Badge>
            </div>
            <div className="flex flex-col gap-3">
              {closedOut.map(appt => (
                <TriageCard 
                  key={appt.id} 
                  appt={appt} 
                  primaryAction="View Summary" 
                />
              ))}
            </div>
          </section>
        )}

      </main>
    </div>
  );
}

import React, { useState } from "react";
import {
  APPOINTMENTS,
  SUMMARY,
  DATE_LABEL,
  DATE_SHORT,
  type ScheduleAppointment,
  type AppointmentStatus,
} from "./_data";
import {
  Calendar,
  Clock,
  Video,
  MapPin,
  AlertCircle,
  FileText,
  User,
  CheckCircle2,
  XCircle,
  MoreVertical,
  Calendar as CalendarIcon,
  ChevronRight,
  MessageSquare,
  FileWarning,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const START_HOUR = 8;
const END_HOUR = 17; // 5 PM
const MINS_IN_DAY = (END_HOUR - START_HOUR) * 60;
const PIXELS_PER_MINUTE = 2.5;

function getStatusConfig(status: AppointmentStatus) {
  switch (status) {
    case "scheduled":
      return {
        bg: "bg-blue-50 border-blue-200",
        accent: "bg-blue-500",
        text: "text-blue-900",
        label: "Scheduled",
      };
    case "checked_in":
      return {
        bg: "bg-emerald-50 border-emerald-200",
        accent: "bg-emerald-500",
        text: "text-emerald-900",
        label: "Checked In",
      };
    case "in_session":
      return {
        bg: "bg-purple-50 border-purple-200",
        accent: "bg-purple-500",
        text: "text-purple-900",
        label: "In Session",
      };
    case "needs_signature":
      return {
        bg: "bg-amber-50 border-amber-200",
        accent: "bg-amber-500",
        text: "text-amber-900",
        label: "Needs Sig.",
      };
    case "completed":
      return {
        bg: "bg-gray-50 border-gray-200",
        accent: "bg-gray-500",
        text: "text-gray-900",
        label: "Completed",
      };
    case "no_show":
      return {
        bg: "bg-rose-50 border-rose-200",
        accent: "bg-rose-500",
        text: "text-rose-900",
        label: "No Show",
      };
    case "cancelled":
      return {
        bg: "bg-gray-100 border-gray-300",
        accent: "bg-gray-400",
        text: "text-gray-600",
        label: "Cancelled",
      };
    default:
      return {
        bg: "bg-gray-50 border-gray-200",
        accent: "bg-gray-500",
        text: "text-gray-900",
        label: status,
      };
  }
}

export function TimelineDayGrid() {
  const [selectedApptId, setSelectedApptId] = useState<string | null>(null);

  const selectedAppt = APPOINTMENTS.find((a) => a.id === selectedApptId);

  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

  // Hardcode current time to 10:45 AM for hypothesis
  const nowMinutes = 10 * 60 + 45;
  const nowTop = (nowMinutes - START_HOUR * 60) * PIXELS_PER_MINUTE;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col" style={{ fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      
      {/* Top Header & Summary */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="bg-slate-100 p-2 rounded-lg text-slate-700">
              <CalendarIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">{DATE_LABEL}</h1>
              <p className="text-sm text-slate-500 font-medium">Timeline View</p>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex gap-4">
              <div className="flex flex-col items-end">
                <span className="text-2xl font-bold leading-none text-slate-900">{SUMMARY.total}</span>
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total</span>
              </div>
              <div className="w-px h-8 bg-slate-200 self-center" />
              <div className="flex flex-col items-end">
                <span className="text-2xl font-bold leading-none text-amber-600">{SUMMARY.unsigned}</span>
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Unsigned</span>
              </div>
              <div className="w-px h-8 bg-slate-200 self-center" />
              <div className="flex flex-col items-end">
                <span className="text-2xl font-bold leading-none text-rose-600">{SUMMARY.noShow}</span>
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">No Show</span>
              </div>
            </div>
            
            <Button variant="default" className="bg-slate-900 text-white hover:bg-slate-800 rounded-full px-6 font-semibold">
              + New Appointment
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Timeline Scroll Area */}
        <div className="flex-1 overflow-y-auto relative bg-white">
          <div className="relative min-w-[600px] px-6" style={{ height: `${MINS_IN_DAY * PIXELS_PER_MINUTE + 100}px`, marginTop: '20px' }}>
            
            {/* Time Grid Lines */}
            {hours.map((hour) => {
              const displayHour = hour > 12 ? hour - 12 : hour;
              const ampm = hour >= 12 ? "PM" : "AM";
              const top = (hour * 60 - START_HOUR * 60) * PIXELS_PER_MINUTE;
              return (
                <div key={hour} className="absolute left-0 right-6 flex items-start" style={{ top: `${top}px` }}>
                  <div className="w-20 pr-4 text-right transform -translate-y-2.5">
                    <span className="text-sm font-semibold text-slate-400">{displayHour} {ampm}</span>
                  </div>
                  <div className="flex-1 border-t border-slate-100" />
                </div>
              );
            })}

            {/* Now Line */}
            <div className="absolute left-20 right-6 flex items-center z-10 pointer-events-none" style={{ top: `${nowTop}px` }}>
              <div className="w-2 h-2 rounded-full bg-rose-500 transform -translate-x-1" />
              <div className="flex-1 border-t-2 border-rose-500 opacity-50" />
              <div className="bg-rose-500 text-white text-xs font-bold px-2 py-0.5 rounded ml-2 shadow-sm">
                10:45 AM
              </div>
            </div>

            {/* Appointments */}
            <div className="absolute left-20 right-6 bottom-0" style={{ top: 0 }}>
              {APPOINTMENTS.map((appt) => {
                const top = (appt.startMinutes - START_HOUR * 60) * PIXELS_PER_MINUTE;
                const height = appt.durationMin * PIXELS_PER_MINUTE;
                const isSelected = selectedApptId === appt.id;
                const statusConfig = getStatusConfig(appt.status);

                return (
                  <div
                    key={appt.id}
                    onClick={() => setSelectedApptId(isSelected ? null : appt.id)}
                    className={cn(
                      "absolute left-4 right-4 rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden group shadow-sm hover:shadow-md",
                      statusConfig.bg,
                      isSelected ? "ring-2 ring-slate-400 ring-offset-2 z-10" : "z-0"
                    )}
                    style={{ top: `${top}px`, height: `${height}px` }}
                  >
                    <div className={cn("absolute left-0 top-0 bottom-0 w-1.5", statusConfig.accent)} />
                    
                    <div className="p-3 pl-4 flex flex-col h-full relative">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className={cn("font-bold text-[15px] leading-none mb-1", statusConfig.text)}>
                            {appt.patientName}
                          </h3>
                          <p className={cn("text-xs font-medium opacity-80 flex items-center gap-1", statusConfig.text)}>
                            {appt.timeStart} - {appt.timeEnd} 
                            <span className="opacity-50 mx-1">•</span> 
                            {appt.type}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {appt.location === "Telehealth" ? (
                            <div className="bg-purple-100 text-purple-700 p-1.5 rounded-md" title="Telehealth">
                              <Video className="w-3.5 h-3.5" />
                            </div>
                          ) : (
                            <div className="bg-slate-100 text-slate-600 p-1.5 rounded-md" title="In Office">
                              <MapPin className="w-3.5 h-3.5" />
                            </div>
                          )}
                          <Badge variant="outline" className={cn("text-xs border-current opacity-80", statusConfig.text)}>
                            {statusConfig.label}
                          </Badge>
                        </div>
                      </div>

                      {height > 60 && (
                        <div className="mt-auto flex items-end justify-between">
                          <div className="flex gap-2">
                            {appt.alerts.length > 0 && (
                              <div className="flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100/50 px-2 py-1 rounded-md">
                                <AlertCircle className="w-3.5 h-3.5" />
                                {appt.alerts.length} Alerts
                              </div>
                            )}
                          </div>
                          <span className={cn("text-xs font-medium opacity-60", statusConfig.text)}>{appt.provider}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Context Side Panel */}
        {selectedAppt && (
          <div className="w-[400px] border-l border-slate-200 bg-slate-50 flex flex-col shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)] z-20">
            <div className="p-6 border-b border-slate-200 bg-white">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{selectedAppt.patientName}</h2>
                  <p className="text-sm text-slate-500 font-medium mt-1">DOB: {selectedAppt.dob} • {selectedAppt.insurance}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setSelectedApptId(null)} className="text-slate-400 hover:text-slate-600">
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>

              <div className="flex gap-2 mt-4">
                {selectedAppt.status === "scheduled" && (
                  <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">Check In</Button>
                )}
                {selectedAppt.status === "checked_in" && (
                  <Button className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-semibold">Start Session</Button>
                )}
                {selectedAppt.status === "needs_signature" && (
                  <Button className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold">Sign Note</Button>
                )}
                <Button variant="outline" size="icon" className="shrink-0"><MoreVertical className="w-4 h-4" /></Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" /> Appointment Details
                </h4>
                <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden">
                  <div className="p-4 bg-white space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-500">Time</span>
                      <span className="text-sm font-semibold text-slate-900">{selectedAppt.timeStart} - {selectedAppt.timeEnd}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-500">Type</span>
                      <span className="text-sm font-semibold text-slate-900">{selectedAppt.type}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-slate-500">Provider</span>
                      <span className="text-sm font-semibold text-slate-900">{selectedAppt.provider}</span>
                    </div>
                    {selectedAppt.copay && (
                      <div className="flex justify-between">
                        <span className="text-sm text-slate-500">Copay</span>
                        <span className="text-sm font-bold text-emerald-600">{selectedAppt.copay}</span>
                      </div>
                    )}
                  </div>
                </Card>
              </div>

              {selectedAppt.alerts.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-slate-400" /> Active Alerts
                  </h4>
                  <div className="space-y-2">
                    {selectedAppt.alerts.map((alert, i) => (
                      <div key={i} className={cn(
                        "p-3 rounded-lg flex items-start gap-3 border",
                        alert.tone === "amber" ? "bg-amber-50 border-amber-200 text-amber-900" :
                        alert.tone === "red" ? "bg-rose-50 border-rose-200 text-rose-900" :
                        alert.tone === "purple" ? "bg-purple-50 border-purple-200 text-purple-900" :
                        "bg-blue-50 border-blue-200 text-blue-900"
                      )}>
                        <AlertCircle className={cn(
                          "w-4 h-4 mt-0.5 shrink-0",
                          alert.tone === "amber" ? "text-amber-500" :
                          alert.tone === "red" ? "text-rose-500" :
                          alert.tone === "purple" ? "text-purple-500" :
                          "text-blue-500"
                        )} />
                        <span className="text-sm font-medium">{alert.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedAppt.tasks.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-slate-400" /> Tasks
                  </h4>
                  <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white">
                    <div className="divide-y divide-slate-100">
                      {selectedAppt.tasks.map((task, i) => (
                        <div key={i} className="p-3 flex items-start gap-3 hover:bg-slate-50 transition-colors">
                          <input type="checkbox" className="mt-1 rounded border-slate-300 text-slate-900 focus:ring-slate-900" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-slate-800 leading-snug">{task.text}</p>
                          </div>
                          {task.priority === "high" && (
                            <Badge variant="secondary" className="bg-rose-100 text-rose-700 hover:bg-rose-100 border-none shrink-0 text-[10px]">High</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              )}

              <div className="space-y-3">
                <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" /> Clinical Context
                </h4>
                <div className="space-y-3">
                  {selectedAppt.diagnoses.map((dx, i) => (
                    <div key={i} className="text-sm font-medium text-slate-700 bg-slate-100 px-3 py-2 rounded-lg border border-slate-200">
                      {dx}
                    </div>
                  ))}
                  
                  {selectedAppt.recentNote && (
                    <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4">
                      <p className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">Most Recent Note</p>
                      <p className="text-sm text-blue-800/80 italic">"{selectedAppt.recentNote}"</p>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}

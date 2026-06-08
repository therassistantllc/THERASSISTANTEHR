import React from "react";
import { APPOINTMENTS, SUMMARY, DATE_LABEL, DATE_SHORT, type ScheduleAppointment } from "./_data";
import { Clock, Calendar, CheckCircle2, AlertTriangle, FileText, User, CreditCard, Activity, Video, MapPin, Search, Plus, Bell, ChevronRight, Stethoscope, Hash, LayoutDashboard, Settings, Phone } from "lucide-react";
import "./NowPatientCockpit.css";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function NowPatientCockpit() {
  const activeAppt = APPOINTMENTS.find(a => a.status === "in_session") || APPOINTMENTS[0];
  
  return (
    <div className="cockpit-theme min-h-screen flex w-full overflow-hidden text-slate-50 selection:bg-sky-500/30">
      
      {/* Left Rail: Timeline / Upcoming */}
      <aside className="w-80 border-r border-slate-800/60 bg-slate-950/50 flex flex-col z-10 shrink-0">
        <div className="p-5 border-b border-slate-800/60 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-200">Today's Flight</h2>
            <div className="text-xs text-slate-400 font-mono mt-0.5">{DATE_LABEL}</div>
          </div>
          <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
            <Bell className="w-4 h-4 text-slate-400" />
          </div>
        </div>
        
        <div className="p-4 grid grid-cols-2 gap-2 border-b border-slate-800/60 bg-slate-900/20">
          <div className="glass-panel rounded-lg p-3">
            <div className="text-2xl font-semibold text-slate-200">{SUMMARY.total}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mt-1">Appts</div>
          </div>
          <div className="glass-panel rounded-lg p-3">
            <div className="text-2xl font-semibold text-sky-400">{SUMMARY.pending}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mt-1">Pending</div>
          </div>
          <div className="glass-panel rounded-lg p-3">
            <div className="text-2xl font-semibold text-red-400">{SUMMARY.unsigned}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mt-1">Unsigned</div>
          </div>
          <div className="glass-panel rounded-lg p-3">
            <div className="text-2xl font-semibold text-slate-400">{SUMMARY.noShow}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mt-1">No-show</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto cockpit-scroll p-4 pr-2">
          <div className="space-y-6">
            {APPOINTMENTS.map((appt, i) => {
              const isActive = appt.id === activeAppt.id;
              const isPast = appt.status === 'completed' || appt.status === 'no_show';
              
              return (
                <div key={appt.id} className="relative flex gap-4">
                  {i !== APPOINTMENTS.length - 1 && <div className="status-line" />}
                  <div className="mt-1">
                    <div className={`status-dot ${appt.status} ring-4 ring-slate-950`} />
                  </div>
                  
                  <div className={`flex-1 rounded-lg transition-all ${isActive ? 'glass-panel-active p-3 -mt-2' : 'hover:bg-slate-800/30 p-2 -mt-1'} ${isPast ? 'opacity-50' : ''}`}>
                    <div className="flex justify-between items-start mb-1">
                      <div className="text-xs font-mono text-slate-400">{appt.timeStart}</div>
                      {appt.location === "Telehealth" && <Video className="w-3 h-3 text-slate-500" />}
                    </div>
                    <div className={`font-medium ${isActive ? 'text-sky-300 text-lg' : 'text-slate-200'}`}>
                      {appt.patientName}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                      <span className="truncate">{appt.type}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Main Cockpit Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-900 via-[#0B1120] to-[#0B1120] relative">
        {/* Subtle grid background */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none opacity-50" />
        
        <header className="p-8 pb-6 flex items-start justify-between z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Badge variant="outline" className="bg-sky-500/10 text-sky-400 border-sky-500/20 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-sky-400 mr-2 animate-pulse" />
                Active Session
              </Badge>
              <div className="text-slate-400 font-mono text-sm">{activeAppt.timeStart} - {activeAppt.timeEnd} ({activeAppt.durationMin}m)</div>
            </div>
            <h1 className="text-5xl font-bold tracking-tight text-white mb-2">{activeAppt.patientName}</h1>
            <div className="flex items-center gap-4 text-slate-400">
              <span className="flex items-center gap-1.5"><User className="w-4 h-4" /> DOB: {activeAppt.dob}</span>
              <span className="w-1 h-1 rounded-full bg-slate-700" />
              <span className="flex items-center gap-1.5"><Activity className="w-4 h-4" /> {activeAppt.type}</span>
              <span className="w-1 h-1 rounded-full bg-slate-700" />
              <span className="flex items-center gap-1.5">
                {activeAppt.location === "Telehealth" ? <Video className="w-4 h-4" /> : <MapPin className="w-4 h-4" />} 
                {activeAppt.location}
              </span>
            </div>
          </div>
          
          <div className="flex gap-3">
            <Button variant="outline" className="bg-slate-800/50 border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white">
              <User className="w-4 h-4 mr-2" />
              Open Chart
            </Button>
            <Button variant="outline" className="bg-slate-800/50 border-slate-700 text-slate-200 hover:bg-slate-700 hover:text-white">
              <Phone className="w-4 h-4 mr-2" />
              Join Call
            </Button>
          </div>
        </header>

        <div className="flex-1 p-8 pt-2 grid grid-cols-12 gap-6 z-10 overflow-hidden">
          
          {/* Left Column: Quick Info */}
          <div className="col-span-4 flex flex-col gap-6 overflow-y-auto cockpit-scroll pb-8 pr-2">
            
            <section className="glass-panel rounded-xl p-5">
              <h3 className="text-xs uppercase tracking-wider text-slate-500 font-mono mb-4 flex items-center"><AlertTriangle className="w-3.5 h-3.5 mr-2" /> Active Alerts</h3>
              {activeAppt.alerts.length > 0 ? (
                <div className="space-y-3">
                  {activeAppt.alerts.map((alert, i) => (
                    <div key={i} className={`p-3 rounded-lg border flex items-start gap-3
                      ${alert.tone === 'red' ? 'bg-red-950/30 border-red-900/50 text-red-200' : 
                        alert.tone === 'amber' ? 'bg-amber-950/30 border-amber-900/50 text-amber-200' :
                        alert.tone === 'purple' ? 'bg-purple-950/30 border-purple-900/50 text-purple-200' :
                        'bg-blue-950/30 border-blue-900/50 text-blue-200'
                      }`}>
                      <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${alert.tone === 'red' ? 'text-red-400' : alert.tone === 'amber' ? 'text-amber-400' : alert.tone === 'purple' ? 'text-purple-400' : 'text-blue-400'}`} />
                      <span className="text-sm">{alert.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-400 italic">No active alerts</div>
              )}
            </section>

            <section className="glass-panel rounded-xl p-5">
              <h3 className="text-xs uppercase tracking-wider text-slate-500 font-mono mb-4 flex items-center"><CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Today's Tasks</h3>
              <div className="space-y-3">
                {activeAppt.tasks.map((task, i) => (
                  <div key={i} className="flex items-start gap-3 group">
                    <button className="w-5 h-5 rounded border border-slate-600 flex items-center justify-center shrink-0 mt-0.5 group-hover:border-sky-500 transition-colors">
                      {/* unchecked */}
                    </button>
                    <div>
                      <div className="text-sm text-slate-200 leading-tight">{task.text}</div>
                      <div className="text-xs text-slate-500 font-mono mt-1">
                        {task.priority === 'high' && <span className="text-amber-400">HIGH PRIORITY</span>}
                        {task.priority === 'med' && <span>MED PRIORITY</span>}
                        {task.priority === 'low' && <span>LOW PRIORITY</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="glass-panel rounded-xl p-5">
              <h3 className="text-xs uppercase tracking-wider text-slate-500 font-mono mb-4 flex items-center"><CreditCard className="w-3.5 h-3.5 mr-2" /> Billing</h3>
              <div className="space-y-4 text-sm">
                <div className="flex justify-between border-b border-slate-800/60 pb-3">
                  <span className="text-slate-400">Insurance</span>
                  <span className="text-slate-200 font-medium text-right">{activeAppt.insurance}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800/60 pb-3">
                  <span className="text-slate-400">CPT Code</span>
                  <span className="text-slate-200 font-mono">{activeAppt.cpt}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Copay</span>
                  {activeAppt.copay ? (
                    <Badge variant="outline" className="bg-emerald-950/30 border-emerald-900/50 text-emerald-400 font-mono">
                      {activeAppt.copay} DUE
                    </Badge>
                  ) : (
                    <span className="text-slate-500 font-mono">$0.00</span>
                  )}
                </div>
              </div>
            </section>

          </div>

          {/* Right Column: Clinical Focus */}
          <div className="col-span-8 flex flex-col gap-6">
            
            <section className="glass-panel rounded-xl p-6 flex-1 flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xs uppercase tracking-wider text-slate-500 font-mono flex items-center"><FileText className="w-3.5 h-3.5 mr-2" /> Clinical Context</h3>
                <Badge variant="outline" className="bg-slate-800 border-slate-700 text-slate-300 rounded text-xs px-2 py-0.5">
                  <Search className="w-3 h-3 mr-1.5 inline" /> Search History
                </Badge>
              </div>
              
              <div className="mb-6">
                <h4 className="text-slate-400 text-sm mb-2">Active Diagnoses</h4>
                <div className="flex flex-wrap gap-2">
                  {activeAppt.diagnoses.map((dx, i) => (
                    <div key={i} className="bg-slate-800/50 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 flex items-center">
                      <Stethoscope className="w-3.5 h-3.5 mr-2 text-slate-500" />
                      {dx}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 bg-slate-900/50 border border-slate-800/60 rounded-lg p-5">
                <h4 className="text-slate-400 text-sm mb-3 flex items-center justify-between">
                  <span>Last Session Note</span>
                  <span className="font-mono text-xs">May 12, 2026</span>
                </h4>
                {activeAppt.recentNote ? (
                  <p className="text-slate-300 leading-relaxed text-[15px]">
                    "{activeAppt.recentNote}"
                  </p>
                ) : (
                  <p className="text-slate-500 italic text-sm">No recent note available.</p>
                )}
              </div>
            </section>

            {/* Bottom Command Bar */}
            <div className="glass-panel rounded-xl p-4 flex items-center gap-4">
              <Button className="flex-1 h-14 bg-sky-600 hover:bg-sky-500 text-white shadow-[0_0_20px_-5px_rgba(2,132,199,0.4)] text-lg">
                <FileText className="w-5 h-5 mr-2" />
                Start Clinical Note
              </Button>
              {activeAppt.copay && (
                <Button variant="outline" className="flex-1 h-14 border-slate-700 bg-slate-800/50 text-slate-200 hover:bg-slate-800 text-lg">
                  <CreditCard className="w-5 h-5 mr-2 text-emerald-400" />
                  Collect {activeAppt.copay}
                </Button>
              )}
              <Button variant="outline" className="flex-1 h-14 border-slate-700 bg-slate-800/50 text-slate-200 hover:bg-slate-800 text-lg">
                <CheckCircle2 className="w-5 h-5 mr-2 text-slate-400" />
                End Session
              </Button>
            </div>

          </div>

        </div>
      </main>

    </div>
  );
}

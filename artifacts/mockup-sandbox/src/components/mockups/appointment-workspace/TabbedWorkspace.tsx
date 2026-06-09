import React, { useState } from "react";
import { WORKSPACE_DATA } from "./_data";
import { 
  User, 
  Activity, 
  FileText, 
  Target, 
  X, 
  Video, 
  CheckCircle, 
  Calendar, 
  FileEdit, 
  CreditCard, 
  Ban, 
  Clock, 
  AlertCircle
} from "lucide-react";

export function TabbedWorkspace() {
  const [activeTab, setActiveTab] = useState<"patient" | "actions" | "note" | "goals">("patient");
  const data = WORKSPACE_DATA;

  const getTabIcon = (tab: string) => {
    switch (tab) {
      case "patient": return <User className="w-5 h-5" />;
      case "actions": return <Activity className="w-5 h-5" />;
      case "note": return <FileText className="w-5 h-5" />;
      case "goals": return <Target className="w-5 h-5" />;
    }
  };

  const tabs = [
    { id: "patient", label: "Patient" },
    { id: "actions", label: "Actions" },
    { id: "note", label: "Note" },
    { id: "goals", label: "Goals" },
  ] as const;

  return (
    <div className="w-[720px] h-[1400px] bg-white shadow-[-4px_0_24px_rgba(0,0,0,0.15)] flex flex-col font-sans text-slate-900 border-l border-slate-200">
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        .font-sans { font-family: 'Inter', sans-serif; }
      `}} />

      {/* Header */}
      <div className="flex-none px-6 py-4 border-b border-slate-200 flex justify-between items-start bg-white z-10">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{data.appointment.clientName}</h2>
          <div className="flex gap-2 mt-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-700">
              {data.appointment.status.replace('_', ' ')}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-600">
              Note: {data.encounter.encounter_status.replace('_', ' ')}
            </span>
          </div>
        </div>
        <button className="text-slate-400 hover:text-slate-700 transition-colors p-1">
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Body with sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-16 flex-none border-r border-slate-200 bg-slate-50 flex flex-col py-4 items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-12 h-12 flex flex-col items-center justify-center rounded-xl transition-all duration-200 ${
                activeTab === tab.id 
                  ? "bg-blue-50 text-blue-600 shadow-sm border border-blue-100" 
                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              }`}
              title={tab.label}
            >
              {getTabIcon(tab.id)}
              <span className="text-[9px] font-medium mt-1">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-6">
          
          {/* Charge Result (shown above content if exists) */}
          {data.chargeResult && activeTab === 'patient' && (
            <div className="mb-6 p-4 rounded-xl bg-green-50 border border-green-200 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="font-semibold text-green-800">Claim Ready</span>
                <span className="text-sm text-green-700 ml-2">Visit documentation complete.</span>
              </div>
              <div className="flex gap-3">
                <button className="px-4 py-2 text-sm font-medium text-blue-600 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors">
                  View Claim →
                </button>
                <button className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm">
                  Sign & Open Next Appointment →
                </button>
              </div>
            </div>
          )}

          {activeTab === "patient" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Appointment Details</h3>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Time</div>
                      <div className="text-sm font-medium text-slate-900">
                        {new Date(data.appointment.scheduledStartAt).toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})} - {new Date(data.appointment.scheduledEndAt).toLocaleTimeString([], {hour: 'numeric', minute:'2-digit'})}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">Duration: 50 min</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Clinician</div>
                      <div className="text-sm font-medium text-slate-900">{data.appointment.providerName}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{data.appointment.serviceLocation}</div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Type</div>
                    <div className="text-sm font-medium text-slate-900">{data.appointment.appointmentType} (CPT: {data.appointment.cptCode})</div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Memo</div>
                    <div className="text-sm text-slate-700 bg-amber-50/50 p-3 rounded-lg border border-amber-100 border-l-4 border-l-amber-400">
                      {data.appointment.memo}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Billing & Insurance</h3>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Insurance</div>
                    <div className="text-sm font-medium text-slate-900">{data.insurance.primaryPolicy.payerName}</div>
                    <div className="text-xs text-slate-500 mt-0.5">Plan: {data.insurance.primaryPolicy.planName} • ID: {data.insurance.primaryPolicy.policyNumber}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Eligibility</div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        <span className="text-sm font-medium text-slate-900">Active</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">Copay: ${data.eligibility.copay_amount}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Authorization</div>
                      <div className="text-sm font-medium text-slate-900 text-green-600 flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" /> Approved
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{data.authorization.authorizationNumber}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "actions" && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h3>
              
              <button className="w-full flex items-center gap-4 p-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm">
                <div className="p-2 bg-blue-500/50 rounded-lg">
                  <FileEdit className="w-5 h-5" />
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold">Start Encounter & Note</div>
                  <div className="text-blue-100 text-sm">Check in patient and begin documentation</div>
                </div>
              </button>

              <button className="w-full flex items-center gap-4 p-4 bg-sky-50 text-sky-700 border border-sky-200 rounded-xl hover:bg-sky-100 transition-colors">
                <div className="p-2 bg-sky-100 rounded-lg text-sky-600">
                  <Video className="w-5 h-5" />
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold">Start Telehealth</div>
                  <div className="text-sky-600/80 text-sm">Generate and open meeting link</div>
                </div>
              </button>

              <button className="w-full flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="p-2 bg-slate-100 rounded-lg text-slate-600">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div className="text-left flex-1">
                  <div className="font-semibold text-slate-900">Collect Payment</div>
                  <div className="text-slate-500 text-sm">Balance: ${data.balance.openBalance.toFixed(2)}</div>
                </div>
              </button>

              <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-200">
                <button className="flex flex-col items-center gap-2 p-4 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
                  <Calendar className="w-5 h-5 text-slate-500" />
                  <span className="text-sm font-medium text-slate-700">Reschedule</span>
                </button>
                <button className="flex flex-col items-center gap-2 p-4 bg-white border border-slate-200 rounded-xl hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition-colors group">
                  <Ban className="w-5 h-5 text-slate-500 group-hover:text-red-600" />
                  <span className="text-sm font-medium text-slate-700 group-hover:text-red-700">Cancel</span>
                </button>
                <button className="flex flex-col items-center gap-2 p-4 bg-white border border-slate-200 rounded-xl hover:bg-orange-50 hover:border-orange-200 hover:text-orange-700 transition-colors group col-span-2">
                  <Clock className="w-5 h-5 text-slate-500 group-hover:text-orange-600" />
                  <span className="text-sm font-medium text-slate-700 group-hover:text-orange-700">Mark No-Show</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === "note" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-slate-900">Current Session Note</h3>
                <span className="px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider bg-blue-50 text-blue-600 border border-blue-100">
                  {data.currentSessionNote.noteStatus.replace('_', ' ')}
                </span>
              </div>
              
              <div className="space-y-4">
                {[
                  { label: "Subjective", content: data.currentSessionNote.subjective },
                  { label: "Objective", content: data.currentSessionNote.objective },
                  { label: "Assessment", content: data.currentSessionNote.assessment },
                  { label: "Plan", content: data.currentSessionNote.plan },
                ].map((section) => (
                  <div key={section.label} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
                      <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">{section.label}</h4>
                    </div>
                    <div className="p-4 text-[15px] leading-relaxed text-slate-800">
                      {section.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "goals" && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-semibold text-slate-900 mb-4">Active Treatment Goals</h3>
              <div className="space-y-3">
                {data.goals.map((goal, i) => (
                  <div key={goal.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center flex-none mt-0.5 text-xs font-bold">
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <p className="text-[15px] text-slate-800 leading-snug">{goal.description}</p>
                      <div className="mt-2 text-xs font-medium text-slate-500 uppercase tracking-wider">Status: {goal.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

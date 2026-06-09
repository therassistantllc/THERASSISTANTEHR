import React from "react";
import { WORKSPACE_DATA } from "./_data";
import {
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  FileText,
  MapPin,
  MoreVertical,
  Phone,
  ShieldAlert,
  ShieldCheck,
  User,
  Video,
  X
} from "lucide-react";

export function CommandBarDashboard() {
  const {
    appointment,
    insurance,
    eligibility,
    balance,
    encounter,
    clientDetails,
    authorization,
    currentSessionNote,
    goals,
    chargeResult,
  } = WORKSPACE_DATA;

  return (
    <div
      className="flex min-h-screen bg-[#f3f4f6] font-sans items-start justify-center p-8"
      style={{
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: \`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
      \` }} />
      
      {/* Drawer Container */}
      <div className="w-[720px] bg-[#f9fafc] rounded-xl shadow-2xl overflow-hidden flex flex-col border border-gray-200" style={{ height: "1400px" }}>
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Visit Workspace</h2>
            <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-2">
              <span>{new Date(appointment.scheduledStartAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
              <span>•</span>
              <span>
                {new Date(appointment.scheduledStartAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                {" - "}
                {new Date(appointment.scheduledEndAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </span>
            </div>
          </div>
          <button className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Command Bar */}
        <div className="px-6 py-4 bg-white border-b border-gray-200 flex items-center justify-between shrink-0 shadow-sm z-10 relative">
          <div className="flex gap-3">
            <button className="flex items-center gap-2 px-4 py-2.5 bg-[#2c6cf6] hover:bg-[#1f55cd] text-white rounded-lg font-medium text-sm transition-colors shadow-sm">
              <CheckCircle className="w-4 h-4" />
              Check In
            </button>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg font-medium text-sm transition-colors border border-indigo-200">
              <FileText className="w-4 h-4" />
              Start Note
            </button>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg font-medium text-sm transition-colors border border-emerald-200">
              <CreditCard className="w-4 h-4" />
              Collect ${eligibility.copay_amount}
            </button>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg font-medium text-sm transition-colors border border-sky-200">
              <Video className="w-4 h-4" />
              Telehealth
            </button>
          </div>
          <button className="p-2.5 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200 bg-white">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>

        {/* Two Column Body */}
        <div className="flex-1 overflow-hidden flex">
          
          {/* Left Column (40%) - Context */}
          <div className="w-[40%] bg-gray-50/50 border-r border-gray-200 overflow-y-auto p-6 flex flex-col gap-6">
            
            {/* Patient Info Card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center font-bold text-lg">
                    {appointment.clientName.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 text-base">{appointment.clientName}</h3>
                    <div className="text-sm text-gray-500 flex items-center gap-1.5 mt-0.5">
                      <User className="w-3.5 h-3.5" />
                      DOB: {new Date(clientDetails.dateOfBirth).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 flex flex-col gap-3 text-sm">
                <div className="flex items-start gap-2.5">
                  <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <span className="text-gray-700 leading-snug">{appointment.serviceLocation}</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <User className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <span className="text-gray-700 leading-snug">{appointment.providerName}</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <FileText className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <span className="text-gray-700 leading-snug">
                    {appointment.appointmentType} ({appointment.cptCode})
                  </span>
                </div>
              </div>
              {appointment.memo && (
                <div className="px-4 py-3 bg-yellow-50/50 border-t border-yellow-100 text-sm">
                  <span className="font-medium text-yellow-800">Memo: </span>
                  <span className="text-yellow-700">{appointment.memo}</span>
                </div>
              )}
            </div>

            {/* Insurance & Eligibility */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <h4 className="font-semibold text-gray-900 text-sm mb-4 uppercase tracking-wider">Insurance & Billing</h4>
              
              <div className="flex flex-col gap-4">
                <div>
                  <div className="text-xs text-gray-500 font-medium uppercase mb-1">Primary Policy</div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    <span className="text-sm font-medium text-gray-900">{insurance.primaryPolicy.payerName}</span>
                  </div>
                  <div className="text-sm text-gray-600 ml-6 mt-0.5">{insurance.primaryPolicy.planName}</div>
                  <div className="text-sm text-gray-600 ml-6 mt-0.5">ID: {insurance.primaryPolicy.policyNumber}</div>
                </div>

                <div className="h-px bg-gray-100"></div>

                <div>
                   <div className="text-xs text-gray-500 font-medium uppercase mb-2">Eligibility</div>
                   <div className="flex items-center gap-2">
                     <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-full uppercase tracking-wide">
                       Active
                     </span>
                     <span className="text-xs text-gray-500">
                       as of {new Date(eligibility.checked_at).toLocaleDateString()}
                     </span>
                   </div>
                   <div className="mt-3 grid grid-cols-2 gap-3">
                     <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
                       <div className="text-xs text-gray-500">Copay</div>
                       <div className="font-semibold text-gray-900 mt-0.5">${eligibility.copay_amount}</div>
                     </div>
                     <div className="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
                       <div className="text-xs text-gray-500">Deductible Rem.</div>
                       <div className="font-semibold text-gray-900 mt-0.5">${eligibility.deductible_remaining}</div>
                     </div>
                   </div>
                </div>

                <div className="h-px bg-gray-100"></div>
                
                <div>
                  <div className="text-xs text-gray-500 font-medium uppercase mb-1">Authorization</div>
                  <div className="flex items-center gap-2">
                     <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-full uppercase tracking-wide">
                       Approved
                     </span>
                     <span className="text-sm font-medium text-gray-700">{authorization.authorizationNumber}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Active Goals */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
               <h4 className="font-semibold text-gray-900 text-sm mb-4 uppercase tracking-wider">Active Goals</h4>
               <ul className="space-y-3">
                 {goals.map(goal => (
                   <li key={goal.id} className="flex gap-2.5 items-start">
                     <div className="w-1.5 h-1.5 rounded-full bg-[#2c6cf6] mt-1.5 shrink-0"></div>
                     <span className="text-sm text-gray-700 leading-snug">{goal.description}</span>
                   </li>
                 ))}
               </ul>
            </div>

          </div>

          {/* Right Column (60%) - Clinical Note */}
          <div className="w-[60%] bg-white overflow-y-auto p-6 flex flex-col gap-6">
            
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                Session Note
                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-semibold rounded-full uppercase tracking-wide">
                  Draft
                </span>
              </h3>
              <div className="text-sm text-gray-500">
                {new Date(currentSessionNote.date).toLocaleDateString()}
              </div>
            </div>

            <div className="space-y-5">
              {/* S */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center justify-between">
                  Subjective
                  <button className="text-xs text-[#2c6cf6] hover:underline normal-case tracking-normal">Copy from last</button>
                </label>
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 border border-gray-200 min-h-[100px] hover:border-[#2c6cf6] transition-colors cursor-text">
                  {currentSessionNote.subjective}
                </div>
              </div>

              {/* O */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center justify-between">
                  Objective
                  <button className="text-xs text-[#2c6cf6] hover:underline normal-case tracking-normal">Templates</button>
                </label>
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 border border-gray-200 min-h-[100px] hover:border-[#2c6cf6] transition-colors cursor-text">
                  {currentSessionNote.objective}
                </div>
              </div>

              {/* A */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center justify-between">
                  Assessment
                  <div className="flex gap-2">
                    <span className="text-xs font-normal text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">F41.1</span>
                  </div>
                </label>
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 border border-gray-200 min-h-[100px] hover:border-[#2c6cf6] transition-colors cursor-text">
                  {currentSessionNote.assessment}
                </div>
              </div>

              {/* P */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center justify-between">
                  Plan
                </label>
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 border border-gray-200 min-h-[100px] hover:border-[#2c6cf6] transition-colors cursor-text">
                  {currentSessionNote.plan}
                </div>
              </div>
            </div>

            {/* Charge Result Mock Area */}
            <div className="mt-8 bg-emerald-50 rounded-xl border border-emerald-200 p-5">
               <div className="flex items-start justify-between">
                 <div>
                   <h4 className="font-semibold text-emerald-800 text-base mb-1 flex items-center gap-2">
                     <CheckCircle className="w-5 h-5" />
                     Note Ready to Sign
                   </h4>
                   <p className="text-emerald-700 text-sm mb-4">Signing this note will generate a claim for {appointment.cptCode}.</p>
                   <div className="flex gap-3">
                     <button className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg shadow-sm text-sm transition-colors">
                       Sign Note & Open Next
                     </button>
                     <button className="px-5 py-2.5 bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200 font-medium rounded-lg shadow-sm text-sm transition-colors">
                       View Claim Preview
                     </button>
                   </div>
                 </div>
               </div>
            </div>

          </div>

        </div>

        {/* Footer Status Bar */}
        <div className="px-6 py-3 bg-gray-900 text-gray-300 flex items-center justify-between shrink-0 text-sm">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
              <span className="font-medium text-white">{appointment.status.replace('_', ' ').toUpperCase()}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              <span>50 min</span>
            </div>
            <div className="flex items-center gap-2 border-l border-gray-700 pl-6">
               <span className="font-medium text-gray-400">Copay:</span>
               <span className="text-white">${eligibility.copay_amount}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             <button className="text-gray-400 hover:text-white transition-colors">Open Chart</button>
             <button className="text-gray-400 hover:text-white transition-colors">Cancel Appt</button>
          </div>
        </div>

      </div>
    </div>
  );
}

import React, { useState } from "react";
import {
  CLAIMS,
  TABS,
  FILTERS,
  COLUMNS,
  DETAIL_TABS,
  money,
  formatDate,
  readyStatusLabel,
  checklistFor,
  isClaimComplete,
  summaryFor,
  type Claim,
} from "./_data";
import {
  RefreshCw,
  Send,
  PauseCircle,
  Check,
  X,
  AlertCircle,
  FileText,
  UserPlus,
  PlayCircle
} from "lucide-react";

export function ActionAffordance() {
  const [selectedTab, setSelectedTab] = useState(TABS[0].id);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [activeClaimId, setActiveClaimId] = useState<string>(CLAIMS[0].id);
  const [activeDetailTab, setActiveDetailTab] = useState(DETAIL_TABS[0].id);

  const activeClaim = CLAIMS.find((c) => c.id === activeClaimId) || CLAIMS[0];
  const summaryTiles = summaryFor(CLAIMS, selectedRowIds);
  const selectedCount = selectedRowIds.length;
  const isAllSelected = selectedCount === CLAIMS.length && CLAIMS.length > 0;

  const toggleAll = () => {
    if (isAllSelected) {
      setSelectedRowIds([]);
    } else {
      setSelectedRowIds(CLAIMS.map((c) => c.id));
    }
  };

  const toggleRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedRowIds.includes(id)) {
      setSelectedRowIds((prev) => prev.filter((r) => r !== id));
    } else {
      setSelectedRowIds((prev) => [...prev, id]);
    }
  };

  const getToneClasses = (tone: string) => {
    if (tone === "red") return "bg-red-50 border-red-200 text-red-900";
    if (tone === "amber") return "bg-amber-50 border-amber-200 text-amber-900";
    if (tone === "green") return "bg-emerald-50 border-emerald-200 text-emerald-900";
    return "bg-white border-slate-200 text-slate-900";
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* 1. Header */}
      <header className="flex-none bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Ready to Generate</h1>
          <p className="text-sm text-slate-500 mt-1">
            Review and generate queued 837P electronic claims.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-md shadow-sm bg-white hover:bg-slate-50 text-sm font-medium transition-colors">
            <RefreshCw className="w-4 h-4 text-slate-500" />
            Refresh
          </button>
          <button
            className={`flex items-center gap-2 px-6 py-2 rounded-md shadow-sm text-sm font-medium transition-colors ${
              selectedCount > 0
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-slate-100 text-slate-400 cursor-not-allowed"
            }`}
          >
            <Send className="w-4 h-4" />
            Generate 837P batch
          </button>
        </div>
      </header>

      {/* Tradeoff Caption Bar */}
      <div className="flex-none bg-indigo-50 border-b border-indigo-100 px-6 py-2 text-xs text-indigo-800 font-medium flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        <span className="uppercase tracking-wider font-bold">Tradeoff:</span>
        always-visible per-row buttons and a persistent action toolbar make interactions obvious but consume horizontal/vertical space, lowering data density (fewer rows and columns visible at once).
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 4. Universal filter rail */}
        <aside className="w-72 flex-none bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 sticky top-0 z-10">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">Filters</h2>
          </div>
          <div className="p-4 space-y-5">
            {FILTERS.map((f) => (
              <div key={f.id} className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600">{f.label}</label>
                {f.kind === "select" && (
                  <select className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none">
                    {f.options?.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                )}
                {f.kind === "text" && (
                  <input
                    type="text"
                    placeholder={f.placeholder}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                )}
                {f.kind === "number" && (
                  <input
                    type="number"
                    placeholder={f.placeholder}
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white placeholder-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                )}
                {f.kind === "date" && (
                  <input
                    type="date"
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white text-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                  />
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          
          {/* 2. Tabs & 3. Summary stat tiles */}
          <div className="flex-none bg-white border-b border-slate-200">
            <div className="flex px-6 pt-2 border-b border-slate-100">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTab(t.id)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    selectedTab === t.id
                      ? "border-blue-600 text-blue-700"
                      : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            
            <div className="p-4 grid grid-cols-6 gap-4 bg-slate-50/50">
              {summaryTiles.map((tile) => (
                <div
                  key={tile.id}
                  className={`p-3 rounded-lg border ${getToneClasses(tile.tone)} flex flex-col shadow-sm`}
                >
                  <span className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-1">
                    {tile.label}
                  </span>
                  <span className="text-2xl font-bold tracking-tight">
                    {tile.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 5. Claims table */}
          <div className="flex-1 overflow-auto bg-white relative">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="sticky top-0 bg-slate-100 border-y border-slate-200 text-slate-600 z-10 shadow-sm">
                <tr>
                  <th className="px-4 py-3 w-12 text-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleAll}
                      className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </th>
                  {COLUMNS.map((col) => (
                    <th key={col.id} className={`px-4 py-3 font-semibold ${col.align === 'right' ? 'text-right' : ''}`}>
                      {col.header}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-semibold text-center sticky right-0 bg-slate-100 border-l border-slate-200">
                    Quick Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {CLAIMS.map((claim) => {
                  const isSelected = selectedRowIds.includes(claim.id);
                  const isActive = activeClaimId === claim.id;
                  const isComplete = isClaimComplete(claim);

                  return (
                    <tr
                      key={claim.id}
                      onClick={() => setActiveClaimId(claim.id)}
                      className={`group cursor-pointer transition-colors ${
                        isSelected ? "bg-blue-50/60" : isActive ? "bg-slate-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-4 py-3 w-12 text-center" onClick={(e) => toggleRow(claim.id, e)}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{claim.client_name}</div>
                        <div className="text-xs text-slate-500 mt-0.5 flex gap-2">
                          <span>{claim.claim_number || "Unassigned"}</span>
                          <span className={
                            claim.ready_status === 'ready' ? "text-emerald-600" :
                            claim.ready_status === 'on_hold' ? "text-amber-600" : "text-blue-600"
                          }>
                            • {readyStatusLabel(claim.ready_status)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">{formatDate(claim.service_date)}</td>
                      <td className="px-4 py-3">{claim.clinician_name}</td>
                      <td className="px-4 py-3">
                        <div className="text-slate-900">{claim.payer_name}</div>
                        <div className="text-xs text-slate-500">{claim.payer_type}</div>
                      </td>
                      <td className="px-4 py-3">{claim.cpt_codes.join(", ") || "—"}</td>
                      <td className="px-4 py-3">
                        {claim.diagnosis_codes.length ? (
                          <div className="flex gap-1">
                            {claim.diagnosis_codes.map(dx => (
                              <span key={dx} className="px-1.5 py-0.5 bg-slate-100 rounded text-xs border border-slate-200">{dx}</span>
                            ))}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">{claim.modifiers.join(", ") || "—"}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">{money(claim.charge_amount)}</td>
                      <td className="px-4 py-3">{claim.place_of_service || "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{claim.rendering_provider_npi || "—"}</td>
                      <td className="px-4 py-3 text-slate-500">
                        <div className="truncate max-w-[120px]" title={claim.billing_provider_name || ""}>
                          {claim.billing_provider_name || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {claim.ready_status === "ready" && isComplete ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                            <Check className="w-3.5 h-3.5" /> Ready
                          </span>
                        ) : claim.ready_status === "ready" && !isComplete ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-100 text-rose-800">
                            <X className="w-3.5 h-3.5" /> Incomplete
                          </span>
                        ) : claim.ready_status === "on_hold" ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                            <PauseCircle className="w-3.5 h-3.5" /> Held
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            <AlertCircle className="w-3.5 h-3.5" /> Needs Batch
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 sticky right-0 bg-white group-hover:bg-slate-50 border-l border-slate-100 text-center shadow-[-4px_0_12px_rgba(0,0,0,0.02)]">
                        <div className="flex items-center justify-center gap-2" onClick={e => e.stopPropagation()}>
                          <button 
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={!isComplete}
                          >
                            <PlayCircle className="w-3.5 h-3.5" />
                            Gen
                          </button>
                          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors shadow-sm">
                            <PauseCircle className="w-3.5 h-3.5" />
                            Hold
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Persistent Bulk Action Toolbar */}
          {selectedCount > 0 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-6 animate-in slide-in-from-bottom-8 z-50 border border-slate-700">
              <div className="flex items-center gap-3 pr-6 border-r border-slate-700">
                <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">
                  {selectedCount}
                </div>
                <span className="font-semibold tracking-wide">Claims Selected</span>
              </div>
              <div className="flex items-center gap-3">
                <button className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold shadow transition-colors">
                  <Send className="w-4 h-4" />
                  Generate {selectedCount} Claims
                </button>
                <button className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg font-semibold transition-colors">
                  <PauseCircle className="w-4 h-4" />
                  Place on Hold
                </button>
                <button className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg font-semibold transition-colors">
                  <UserPlus className="w-4 h-4" />
                  Assign Biller
                </button>
              </div>
            </div>
          )}

        </main>

        {/* 6. Right-side detail panel */}
        <aside className="w-96 flex-none bg-white border-l border-slate-200 flex flex-col shadow-[-4px_0_24px_rgba(0,0,0,0.03)] z-20">
          <div className="p-5 border-b border-slate-200 bg-slate-50/80">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              Claim Details
            </h3>
            <div className="mt-2 text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{activeClaim.client_name}</span> • DOS: {formatDate(activeClaim.service_date)}
            </div>
            
            <div className="mt-5 grid grid-cols-2 gap-3">
               <button className="flex justify-center items-center gap-2 w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-bold shadow-sm transition-colors text-sm">
                 <Send className="w-4 h-4" /> Generate
               </button>
               <button className="flex justify-center items-center gap-2 w-full px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md font-bold shadow-sm transition-colors text-sm">
                 <PauseCircle className="w-4 h-4" /> Hold
               </button>
            </div>
          </div>

          <div className="flex border-b border-slate-200 bg-white px-2">
            {DETAIL_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveDetailTab(t.id)}
                className={`flex-1 py-3 text-xs font-bold text-center border-b-2 transition-colors px-1 whitespace-nowrap ${
                  activeDetailTab === t.id
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-5 bg-white">
            {activeDetailTab === "checklist" && (
              <div className="space-y-4">
                <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">837P Readiness Checks</h4>
                <div className="space-y-3">
                  {checklistFor(activeClaim).map((check) => (
                    <div key={check.id} className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 bg-slate-50/50">
                      {check.ok ? (
                        <div className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Check className="w-3.5 h-3.5 font-bold" />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <X className="w-3.5 h-3.5 font-bold" />
                        </div>
                      )}
                      <div>
                        <div className={`text-sm font-medium ${check.ok ? "text-slate-700" : "text-rose-700"}`}>
                          {check.label}
                        </div>
                        {!check.ok && (
                          <button className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2">
                            Fix issue
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {activeDetailTab !== "checklist" && (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
                <FileText className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm font-medium">Select '837P field checklist' to view checks.</p>
              </div>
            )}
          </div>
        </aside>

      </div>
    </div>
  );
}

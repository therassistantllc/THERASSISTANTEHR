import React, { useState } from "react";
import { 
  CheckCircle2, 
  AlertCircle, 
  XCircle, 
  RefreshCw, 
  Play, 
  Check, 
  PauseCircle, 
  FileText, 
  AlertTriangle,
  ChevronRight,
  Filter,
  CheckSquare
} from "lucide-react";
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
  HIGH_DOLLAR_THRESHOLD, 
  Claim 
} from "./_data";

export function AccessibleReadable() {
  const [selectedClaimIds, setSelectedClaimIds] = useState<Set<string>>(new Set());
  const [selectedClaimId, setSelectedClaimId] = useState<string>(CLAIMS[0].id);
  const [activeTab, setActiveTab] = useState<string>(TABS[0].id);
  const [activeDetailTab, setActiveDetailTab] = useState<string>(DETAIL_TABS[0].id);

  const selectedClaim = CLAIMS.find((c) => c.id === selectedClaimId) || CLAIMS[0];
  const stats = summaryFor(CLAIMS, Array.from(selectedClaimIds));

  const toggleAll = () => {
    if (selectedClaimIds.size === CLAIMS.length) {
      setSelectedClaimIds(new Set());
    } else {
      setSelectedClaimIds(new Set(CLAIMS.map(c => c.id)));
    }
  };

  const toggleRow = (id: string) => {
    const next = new Set(selectedClaimIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedClaimIds(next);
  };

  const renderStatus = (status: string) => {
    switch (status) {
      case "ready":
        return (
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 text-green-900 font-bold border-2 border-green-800">
            <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            Ready
          </span>
        );
      case "on_hold":
        return (
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 text-amber-900 font-bold border-2 border-amber-800">
            <PauseCircle className="w-5 h-5" aria-hidden="true" />
            On Hold
          </span>
        );
      case "needs_batch_assignment":
        return (
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 text-blue-900 font-bold border-2 border-blue-800">
            <AlertCircle className="w-5 h-5" aria-hidden="true" />
            Needs Batch
          </span>
        );
      default:
        return <span>{status}</span>;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-white text-slate-900 font-sans text-base">
      {/* EXPLICIT TRADEOFF CAPTION */}
      <div className="bg-slate-900 text-white text-lg p-4 font-medium flex items-start gap-3 border-b-4 border-blue-600">
        <AlertCircle className="w-6 h-6 flex-shrink-0 mt-0.5 text-blue-400" aria-hidden="true" />
        <p>
          <span className="font-bold text-blue-300 uppercase tracking-wide">Tradeoff:</span> Larger type, higher contrast, and generous spacing dramatically improve readability and accessibility but reduce information density — fewer rows fit on screen, so billers scroll more.
        </p>
      </div>

      {/* REGION 1: HEADER */}
      <header className="px-6 py-8 border-b-2 border-slate-300 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-slate-50">
        <div>
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Ready to Generate</h1>
          <p className="text-xl text-slate-700 mt-2 font-medium">
            Review queued claims, confirm 837P requirements, and generate electronic claim batches.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border-2 border-slate-400 bg-white text-slate-800 font-bold hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600 focus-visible:ring-offset-2 transition-colors">
            <RefreshCw className="w-5 h-5" aria-hidden="true" />
            Refresh Data
          </button>
          <button className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border-2 border-blue-900 bg-blue-700 text-white font-bold hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600 focus-visible:ring-offset-2 transition-colors">
            <Play className="w-5 h-5 fill-current" aria-hidden="true" />
            Generate 837P Batch ({selectedClaimIds.size})
          </button>
        </div>
      </header>

      {/* REGION 2: TABS */}
      <div className="px-6 pt-4 border-b-2 border-slate-300 bg-white">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Claim views">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3 text-lg font-bold border-b-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600 focus-visible:ring-offset-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-700 text-blue-800"
                  : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* REGION 3: SUMMARY STAT TILES */}
      <div className="p-6 bg-slate-50 border-b-2 border-slate-300">
        <h2 className="sr-only">Summary Statistics</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {stats.map((stat) => {
            let bgColor = "bg-white border-slate-300 text-slate-900";
            let icon = null;
            
            if (stat.tone === "red") {
              bgColor = "bg-red-50 border-red-700 text-red-900";
              icon = <AlertTriangle className="w-6 h-6 text-red-700" aria-hidden="true" />;
            } else if (stat.tone === "amber") {
              bgColor = "bg-amber-50 border-amber-700 text-amber-900";
              icon = <AlertCircle className="w-6 h-6 text-amber-700" aria-hidden="true" />;
            } else if (stat.tone === "green") {
              bgColor = "bg-green-50 border-green-700 text-green-900";
              icon = <CheckCircle2 className="w-6 h-6 text-green-700" aria-hidden="true" />;
            }

            return (
              <div key={stat.id} className={`p-5 rounded-xl border-2 shadow-sm flex flex-col gap-2 ${bgColor}`}>
                <div className="flex items-center justify-between">
                  <span className="text-base font-bold uppercase tracking-wider opacity-90">{stat.label}</span>
                  {icon}
                </div>
                <span className="text-3xl font-extrabold">{stat.value}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* REGION 4: UNIVERSAL FILTER RAIL */}
        <aside className="w-80 flex-shrink-0 border-r-2 border-slate-300 bg-white overflow-y-auto p-6 hidden lg:block">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b-2 border-slate-200">
            <Filter className="w-6 h-6 text-slate-800" aria-hidden="true" />
            <h2 className="text-xl font-bold text-slate-900">Filters</h2>
          </div>
          
          <div className="space-y-6">
            {FILTERS.map((filter) => (
              <div key={filter.id} className="flex flex-col gap-2">
                <label htmlFor={`filter-${filter.id}`} className="text-base font-bold text-slate-800">
                  {filter.label}
                </label>
                {filter.kind === "select" ? (
                  <select
                    id={`filter-${filter.id}`}
                    className="w-full p-3 text-lg border-2 border-slate-400 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-4 focus:ring-blue-600 focus:border-blue-700"
                    aria-label={filter.label}
                  >
                    {filter.options?.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={filter.kind}
                    id={`filter-${filter.id}`}
                    placeholder={filter.placeholder}
                    className="w-full p-3 text-lg border-2 border-slate-400 rounded-lg bg-white text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-4 focus:ring-blue-600 focus:border-blue-700"
                  />
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* REGION 5: CLAIMS TABLE */}
        <main className="flex-1 overflow-auto bg-white p-6 relative">
          <h2 className="sr-only">Claims List</h2>
          <div className="border-2 border-slate-300 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100 border-b-2 border-slate-300 text-lg">
                <tr>
                  <th scope="col" className="p-4 border-r-2 border-slate-200 w-[60px]">
                    <label className="sr-only" htmlFor="select-all">Select all claims</label>
                    <input
                      type="checkbox"
                      id="select-all"
                      checked={selectedClaimIds.size === CLAIMS.length && CLAIMS.length > 0}
                      onChange={toggleAll}
                      className="w-6 h-6 rounded border-2 border-slate-500 text-blue-700 focus:ring-4 focus:ring-blue-600 focus:ring-offset-2 cursor-pointer"
                    />
                  </th>
                  {COLUMNS.map((col) => (
                    <th 
                      key={col.id} 
                      scope="col" 
                      className={`p-4 font-extrabold text-slate-900 border-r-2 border-slate-200 ${col.align === 'right' ? 'text-right' : ''}`}
                    >
                      {col.header}
                    </th>
                  ))}
                  <th scope="col" className="p-4 font-extrabold text-slate-900">Actions</th>
                </tr>
              </thead>
              <tbody className="text-lg">
                {CLAIMS.map((claim) => {
                  const isSelected = selectedClaimIds.has(claim.id);
                  const isRowActive = selectedClaimId === claim.id;
                  
                  return (
                    <tr 
                      key={claim.id} 
                      className={`
                        border-b border-slate-200 transition-colors
                        ${isRowActive ? 'bg-blue-50 border-l-4 border-l-blue-600' : 'hover:bg-slate-50 border-l-4 border-l-transparent'}
                      `}
                      onClick={(e) => {
                        // prevent row selection when clicking interactive elements
                        if ((e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'BUTTON') {
                          setSelectedClaimId(claim.id);
                        }
                      }}
                    >
                      <td className="p-4 border-r-2 border-slate-200">
                        <label className="sr-only" htmlFor={`select-${claim.id}`}>Select claim {claim.claim_number}</label>
                        <input
                          type="checkbox"
                          id={`select-${claim.id}`}
                          checked={isSelected}
                          onChange={() => toggleRow(claim.id)}
                          className="w-6 h-6 rounded border-2 border-slate-500 text-blue-700 focus:ring-4 focus:ring-blue-600 focus:ring-offset-2 cursor-pointer"
                        />
                      </td>
                      <td className="p-4 border-r-2 border-slate-200">
                        <div className="font-bold text-slate-900">{claim.client_name}</div>
                        <div className="text-slate-600 text-base mt-1 flex flex-col gap-1">
                          <span>Ref: {claim.claim_number || "Unassigned"}</span>
                          {claim.age_days > 14 && (
                            <span className="inline-flex items-center gap-1 text-red-700 font-bold bg-red-100 px-2 py-0.5 rounded">
                              <AlertTriangle className="w-4 h-4" /> Aged {claim.age_days}d
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 border-r-2 border-slate-200 font-medium">{formatDate(claim.service_date)}</td>
                      <td className="p-4 border-r-2 border-slate-200 font-medium">{claim.clinician_name}</td>
                      <td className="p-4 border-r-2 border-slate-200 font-medium">
                        {claim.payer_name}
                        <div className="text-slate-600 text-base mt-1">{claim.payer_type}</div>
                      </td>
                      <td className="p-4 border-r-2 border-slate-200 font-medium">{claim.cpt_codes.join(", ") || "—"}</td>
                      <td className="p-4 border-r-2 border-slate-200 font-medium">{claim.diagnosis_codes.join(", ") || "—"}</td>
                      <td className="p-4 border-r-2 border-slate-200 font-medium">{claim.modifiers.join(", ") || "—"}</td>
                      <td className="p-4 border-r-2 border-slate-200 text-right font-bold text-slate-900 whitespace-nowrap">
                        {money(claim.charge_amount)}
                        {claim.charge_amount >= HIGH_DOLLAR_THRESHOLD && (
                          <div className="text-amber-700 text-base bg-amber-100 px-2 py-0.5 rounded mt-1 inline-flex items-center gap-1">
                             <AlertCircle className="w-4 h-4" /> High $
                          </div>
                        )}
                      </td>
                      <td className="p-4 border-r-2 border-slate-200 font-medium">{claim.place_of_service || "—"}</td>
                      <td className="p-4 border-r-2 border-slate-200 font-medium">{claim.rendering_provider_npi || "Missing"}</td>
                      <td className="p-4 border-r-2 border-slate-200 font-medium">
                        {claim.billing_provider_name}
                        <div className="text-slate-600 text-base mt-1">NPI: {claim.billing_provider_npi || "—"}</div>
                      </td>
                      <td className="p-4 border-r-2 border-slate-200">
                        {renderStatus(claim.ready_status)}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-2">
                          <button className="px-4 py-2 bg-slate-100 border-2 border-slate-300 text-slate-900 font-bold rounded hover:bg-slate-200 focus:ring-4 focus:ring-blue-600 focus:outline-none transition-colors w-full text-left">
                            Generate
                          </button>
                          <button className="px-4 py-2 bg-white border-2 border-slate-300 text-slate-700 font-bold rounded hover:bg-slate-100 focus:ring-4 focus:ring-blue-600 focus:outline-none transition-colors w-full text-left">
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
        </main>

        {/* REGION 6: RIGHT-SIDE DETAIL PANEL */}
        <aside className="w-[450px] flex-shrink-0 border-l-4 border-blue-200 bg-slate-50 flex flex-col hidden xl:flex">
          <div className="p-6 border-b-2 border-slate-300 bg-white">
            <h2 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2 mb-2">
              <FileText className="w-7 h-7 text-blue-700" aria-hidden="true" />
              Selected Claim
            </h2>
            <p className="text-lg font-medium text-slate-700">
              {selectedClaim.client_name} • DOS: {formatDate(selectedClaim.service_date)}
            </p>
          </div>

          <div className="flex flex-col border-b-2 border-slate-300 bg-white" role="tablist" aria-label="Detail Panel Tabs">
            {DETAIL_TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeDetailTab === tab.id}
                onClick={() => setActiveDetailTab(tab.id)}
                className={`px-6 py-4 text-left text-lg font-bold border-l-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600 transition-colors flex items-center justify-between ${
                  activeDetailTab === tab.id
                    ? "border-blue-700 bg-blue-50 text-blue-900"
                    : "border-transparent text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {tab.label}
                <ChevronRight className={`w-5 h-5 ${activeDetailTab === tab.id ? 'text-blue-700' : 'text-slate-400'}`} />
              </button>
            ))}
          </div>

          <div className="p-6 flex-1 overflow-y-auto">
            {activeDetailTab === "checklist" && (
              <div>
                <h3 className="text-xl font-extrabold text-slate-900 mb-6 flex items-center gap-2">
                  <CheckSquare className="w-6 h-6 text-slate-700" aria-hidden="true" />
                  837P Field Checklist
                </h3>
                <div className="space-y-4">
                  {checklistFor(selectedClaim).map((check) => (
                    <div 
                      key={check.id} 
                      className={`p-4 rounded-lg border-2 flex items-start gap-4 ${
                        check.ok 
                          ? "bg-green-50 border-green-300" 
                          : "bg-red-50 border-red-400 shadow-sm"
                      }`}
                    >
                      {check.ok ? (
                        <CheckCircle2 className="w-8 h-8 text-green-700 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <XCircle className="w-8 h-8 text-red-700 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      )}
                      <div>
                        <div className="text-lg font-bold text-slate-900 leading-tight">
                          {check.label}
                        </div>
                        <div className={`text-base font-bold mt-2 inline-flex px-2 py-1 rounded ${check.ok ? 'bg-green-200 text-green-900' : 'bg-red-200 text-red-900'}`}>
                          {check.ok ? "✓ Present" : "✗ Missing"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {activeDetailTab !== "checklist" && (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8 text-center border-2 border-dashed border-slate-300 rounded-xl">
                <FileText className="w-16 h-16 mb-4 text-slate-300" />
                <p className="text-lg font-medium text-slate-700">Content for "{DETAIL_TABS.find(t => t.id === activeDetailTab)?.label}"</p>
                <p className="text-base mt-2">Select the Checklist tab to view accessible validation states.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

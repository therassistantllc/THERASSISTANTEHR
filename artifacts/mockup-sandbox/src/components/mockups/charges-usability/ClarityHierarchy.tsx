import React, { useState, useMemo } from "react";
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
import {
  RefreshCw,
  Send,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronRight,
  MoreHorizontal,
  PauseCircle,
  PlayCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export function ClarityHierarchy() {
  const [activeTab, setActiveTab] = useState(TABS[0].id);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedClaimId, setSelectedClaimId] = useState<string>(CLAIMS[0].id);
  const [detailTab, setDetailTab] = useState(DETAIL_TABS[0].id);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const selectedClaim = useMemo(() => CLAIMS.find((c) => c.id === selectedClaimId) || CLAIMS[0], [selectedClaimId]);
  const summary = useMemo(() => summaryFor(CLAIMS, selectedIds), [selectedIds]);

  const toggleSelectAll = () => {
    if (selectedIds.length === CLAIMS.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(CLAIMS.map((c) => c.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Group summary tiles
  const volumeTiles = summary.filter(t => ["count", "dollars", "selected", "selectedDollars"].includes(t.id));
  const riskTiles = summary.filter(t => ["oldest", "urgent"].includes(t.id));

  // Sort claims: incomplete/urgent first, then by date
  const sortedClaims = useMemo(() => {
    return [...CLAIMS].sort((a, b) => {
      const aNeedsAttn = !isClaimComplete(a) || a.age_days > 14 || a.charge_amount >= 1000 ? 1 : 0;
      const bNeedsAttn = !isClaimComplete(b) || b.age_days > 14 || b.charge_amount >= 1000 ? 1 : 0;
      if (aNeedsAttn !== bNeedsAttn) return bNeedsAttn - aNeedsAttn;
      return new Date(b.service_date).getTime() - new Date(a.service_date).getTime();
    });
  }, []);

  return (
    <div className="flex flex-col h-screen bg-neutral-50/50 text-slate-900 font-sans">
      {/* TRADEOFF CAPTION */}
      <div className="bg-slate-900 text-slate-100 text-xs px-4 py-1.5 flex items-center justify-center shrink-0 tracking-wide font-medium">
        <span className="opacity-70 mr-2">TRADEOFF:</span>
        Hiding the full filter rail and secondary columns behind disclosure reduces cognitive load but costs power users at-a-glance access to every field and filter.
      </div>

      {/* HEADER */}
      <header className="px-6 pt-6 pb-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mb-1">Ready to Generate</h1>
            <p className="text-sm text-slate-500">Review, validate, and batch 837P claims for clearinghouse submission.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-9">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button size="sm" className="h-9 bg-blue-600 hover:bg-blue-700 text-white shadow-sm">
              <Send className="w-4 h-4 mr-2" />
              Generate 837P Batch
            </Button>
          </div>
        </div>

        {/* TABS */}
        <div className="flex items-center justify-between">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
            <TabsList className="bg-slate-100/80 p-1">
              {TABS.map((tab) => (
                <TabsTrigger 
                  key={tab.id} 
                  value={tab.id}
                  className="text-sm px-4 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-700 font-medium transition-all"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* LEFT/CENTER: FILTERS + TABLE */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden border-r border-slate-200 bg-white">
          
          {/* STATS + FILTERS AREA */}
          <div className="px-6 py-5 border-b border-slate-100 shrink-0 bg-slate-50/50">
            <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6">
              
              {/* SUMMARY TILES - Grouped */}
              <div className="flex gap-8">
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Queue Volume</span>
                  <div className="flex gap-2">
                    {volumeTiles.map(tile => (
                      <div key={tile.id} className={cn(
                        "px-3 py-2 rounded-md border min-w-[100px]",
                        tile.tone === 'green' ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-white border-slate-200"
                      )}>
                        <div className="text-xs text-slate-500 mb-0.5">{tile.label}</div>
                        <div className="text-lg font-semibold tabular-nums tracking-tight">{tile.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="w-px bg-slate-200 my-2"></div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Attention Needed</span>
                  <div className="flex gap-2">
                    {riskTiles.map(tile => (
                      <div key={tile.id} className={cn(
                        "px-3 py-2 rounded-md border min-w-[100px]",
                        tile.tone === 'red' ? "bg-red-50 border-red-200 text-red-900" :
                        tile.tone === 'amber' ? "bg-amber-50 border-amber-200 text-amber-900" :
                        "bg-white border-slate-200"
                      )}>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-0.5">
                          {tile.id === 'oldest' ? <Clock className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                          {tile.label}
                        </div>
                        <div className="text-lg font-semibold tabular-nums tracking-tight">{tile.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* SIMPLIFIED FILTER BAR */}
              <div className="flex-1 max-w-xl">
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex justify-between items-center">
                    Filters
                    <Button variant="ghost" size="sm" className="h-5 px-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 -mr-2" onClick={() => setFiltersExpanded(!filtersExpanded)}>
                      {filtersExpanded ? 'Hide all filters' : 'Show all (22)'}
                    </Button>
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2 w-4 h-4 text-slate-400" />
                      <Input placeholder="Search client or claim #..." className="pl-9 h-9 bg-white" />
                    </div>
                    <select className="h-9 border border-slate-200 rounded-md text-sm px-3 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
                      <option>All Payers</option>
                      <option>Commercial</option>
                      <option>Medicaid</option>
                      <option>Medicare</option>
                    </select>
                    <select className="h-9 border border-slate-200 rounded-md text-sm px-3 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
                      <option>Any Status</option>
                      <option>Ready</option>
                      <option>On Hold</option>
                      <option>Needs Batch</option>
                    </select>
                    <Button variant="outline" size="sm" className="h-9 px-3 bg-white border-slate-200" onClick={() => setFiltersExpanded(!filtersExpanded)}>
                      <Filter className="w-4 h-4 mr-2 text-slate-500" />
                      More
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* EXPANDED FILTERS (Progressive Disclosure) */}
            {filtersExpanded && (
              <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-4 gap-4 animate-in slide-in-from-top-2">
                {FILTERS.filter(f => !['client', 'payer', 'status'].includes(f.id)).slice(0, 12).map(f => (
                  <div key={f.id} className="space-y-1">
                    <label className="text-xs text-slate-500 font-medium">{f.label}</label>
                    {f.kind === 'select' ? (
                      <select className="w-full h-8 border border-slate-200 rounded-md text-sm px-2 bg-white">
                        {f.options?.map(o => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <Input placeholder={f.placeholder || f.label} className="h-8 text-sm" />
                    )}
                  </div>
                ))}
                <div className="col-span-4 text-xs text-slate-400 mt-2 italic">+ 7 more specific filters available</div>
              </div>
            )}
          </div>

          {/* TABLE */}
          <ScrollArea className="flex-1">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="sticky top-0 bg-white border-b border-slate-200 shadow-sm z-10 text-slate-500 font-medium text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3 w-10">
                    <Checkbox checked={selectedIds.length === CLAIMS.length && CLAIMS.length > 0} onCheckedChange={toggleSelectAll} />
                  </th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">DOS</th>
                  <th className="px-4 py-3">Payer</th>
                  <th className="px-4 py-3">CPT</th>
                  <th className="px-4 py-3 text-right">Charge</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-6 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedClaims.map((claim) => {
                  const isSelected = selectedIds.includes(claim.id);
                  const isRowActive = selectedClaimId === claim.id;
                  const isComplete = isClaimComplete(claim);
                  const isUrgent = claim.age_days > 14 || claim.charge_amount >= 1000;
                  
                  return (
                    <tr 
                      key={claim.id} 
                      onClick={() => setSelectedClaimId(claim.id)}
                      className={cn(
                        "group hover:bg-slate-50/80 cursor-pointer transition-colors",
                        isRowActive ? "bg-blue-50/40 hover:bg-blue-50/60" : "",
                        isSelected ? "bg-emerald-50/30" : ""
                      )}
                    >
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(claim.id)} />
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className={cn("font-medium", isRowActive ? "text-blue-900" : "text-slate-900")}>
                            {claim.client_name}
                          </span>
                          {!isComplete && (
                            <span className="flex items-center justify-center w-4 h-4 rounded-full bg-red-100 text-red-600" title="Missing required fields">
                              !
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 font-mono">{claim.claim_number || "Unassigned"}</div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {formatDate(claim.service_date)}
                        <div className="text-xs text-slate-400 mt-0.5">{claim.age_days}d ago</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-slate-900 truncate max-w-[200px]">{claim.payer_name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{claim.payer_type}</div>
                      </td>
                      <td className="px-4 py-4 font-mono text-slate-600">
                        {claim.cpt_codes.join(", ")}
                      </td>
                      <td className="px-4 py-4 text-right font-medium tabular-nums text-slate-900">
                        {money(claim.charge_amount)}
                        {isUrgent && (
                          <div className="text-xs text-amber-600 mt-0.5 flex items-center justify-end gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Review
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant="outline" className={cn(
                          "font-medium border-0",
                          claim.ready_status === 'ready' && isComplete ? "bg-emerald-100 text-emerald-800" : 
                          claim.ready_status === 'ready' && !isComplete ? "bg-red-100 text-red-800" : 
                          claim.ready_status === 'on_hold' ? "bg-amber-100 text-amber-800" : 
                          "bg-blue-100 text-blue-800"
                        )}>
                          {readyStatusLabel(claim.ready_status)}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-right text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-blue-600">
                          <ChevronRight className="w-5 h-5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        </div>

        {/* RIGHT SIDE: DETAIL PANEL */}
        <div className="w-[450px] bg-white flex flex-col min-w-0 shrink-0 border-l border-slate-200">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-slate-900">{selectedClaim.client_name}</h2>
              <Badge variant="outline" className={cn(
                "border-0",
                selectedClaim.ready_status === 'ready' ? "bg-emerald-100 text-emerald-800" : 
                selectedClaim.ready_status === 'on_hold' ? "bg-amber-100 text-amber-800" : 
                "bg-blue-100 text-blue-800"
              )}>
                {readyStatusLabel(selectedClaim.ready_status)}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500 font-mono mb-4">
              <span>{selectedClaim.claim_number || "Draft"}</span>
              <span className="text-slate-300">•</span>
              <span>DOS: {formatDate(selectedClaim.service_date)}</span>
            </div>
            
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 bg-blue-600 hover:bg-blue-700">
                <PlayCircle className="w-4 h-4 mr-2" />
                Generate Now
              </Button>
              <Button size="sm" variant="outline" className="flex-1">
                <PauseCircle className="w-4 h-4 mr-2" />
                Hold Claim
              </Button>
            </div>
          </div>

          <div className="px-6 pt-4">
            <Tabs value={detailTab} onValueChange={setDetailTab} className="w-full">
              <TabsList className="w-full grid grid-cols-4 bg-slate-100/80 p-1 h-auto rounded-lg">
                {DETAIL_TABS.map((tab) => {
                  const isChecklist = tab.id === 'checklist';
                  const isComplete = isClaimComplete(selectedClaim);
                  return (
                    <TabsTrigger 
                      key={tab.id} 
                      value={tab.id}
                      className="text-xs py-1.5 px-2 data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-700 rounded-md whitespace-normal text-center h-12 flex items-center justify-center relative"
                      title={tab.label}
                    >
                      {isChecklist && !isComplete && (
                        <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
                      )}
                      <span className="line-clamp-2 leading-tight">{tab.label}</span>
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </Tabs>
          </div>

          <ScrollArea className="flex-1 p-6">
            {detailTab === 'preview' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-3 uppercase tracking-wider">Service Details</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-xs text-slate-500">Clinician</span>
                      <div className="text-sm font-medium text-slate-900">{selectedClaim.clinician_name}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-slate-500">Total Charge</span>
                      <div className="text-sm font-medium text-slate-900">{money(selectedClaim.charge_amount)}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-slate-500">Place of Service</span>
                      <div className="text-sm font-medium text-slate-900">{selectedClaim.place_of_service || "—"}</div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-slate-500">Assigned Biller</span>
                      <div className="text-sm font-medium text-slate-900">{selectedClaim.assigned_biller_name || "Unassigned"}</div>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-3 uppercase tracking-wider">Coding</h3>
                  <div className="space-y-4">
                    <div>
                      <span className="text-xs text-slate-500 block mb-1">CPT / HCPCS</span>
                      <div className="flex gap-2 flex-wrap">
                        {selectedClaim.cpt_codes.map(c => (
                          <Badge key={c} variant="secondary" className="font-mono bg-blue-50 text-blue-700">{c}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block mb-1">Modifiers</span>
                      <div className="flex gap-2 flex-wrap">
                        {selectedClaim.modifiers.length > 0 ? selectedClaim.modifiers.map(m => (
                          <Badge key={m} variant="outline" className="font-mono text-slate-600">{m}</Badge>
                        )) : <span className="text-sm text-slate-400">—</span>}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block mb-1">Diagnoses</span>
                      <div className="flex gap-2 flex-wrap">
                        {selectedClaim.diagnosis_codes.length > 0 ? selectedClaim.diagnosis_codes.map(d => (
                          <Badge key={d} variant="outline" className="font-mono text-slate-600">{d}</Badge>
                        )) : <span className="text-sm text-slate-400">—</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {selectedClaim.hold_reason && (
                  <>
                    <Separator />
                    <div className="bg-amber-50 p-4 rounded-lg border border-amber-100">
                      <h3 className="text-sm font-semibold text-amber-900 mb-1 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        Hold Reason
                      </h3>
                      <p className="text-sm text-amber-800">{selectedClaim.hold_reason}</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {detailTab === 'checklist' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider">837P Readiness</h3>
                  {isClaimComplete(selectedClaim) ? (
                    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-0 shadow-none">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      All Clear
                    </Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-0 shadow-none">
                      <XCircle className="w-3 h-3 mr-1" />
                      Action Required
                    </Badge>
                  )}
                </div>
                
                <div className="space-y-3">
                  {checklistFor(selectedClaim).map((item) => (
                    <div key={item.id} className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border",
                      item.ok ? "bg-slate-50/50 border-slate-100" : "bg-red-50/50 border-red-100"
                    )}>
                      <div className="mt-0.5">
                        {item.ok ? (
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                      </div>
                      <div className={cn("text-sm", item.ok ? "text-slate-600" : "text-red-900 font-medium")}>
                        {item.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailTab === 'validation' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-3 uppercase tracking-wider">Provider Setup</h3>
                  <div className="space-y-4">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <div className="text-xs text-slate-500 mb-1">Billing Provider</div>
                      <div className="text-sm font-medium text-slate-900">{selectedClaim.billing_provider_name || "—"}</div>
                      <div className="text-sm font-mono text-slate-600 mt-1">NPI: {selectedClaim.billing_provider_npi || "—"}</div>
                    </div>
                    <div className={cn("p-3 rounded-lg border", selectedClaim.rendering_provider_npi ? "bg-slate-50 border-slate-100" : "bg-red-50 border-red-100")}>
                      <div className="text-xs text-slate-500 mb-1">Rendering Provider</div>
                      <div className={cn("text-sm font-medium", selectedClaim.rendering_provider_npi ? "text-slate-900" : "text-red-900")}>
                        {selectedClaim.rendering_provider_npi ? "Provided" : "Missing NPI"}
                      </div>
                      <div className="text-sm font-mono text-slate-600 mt-1">NPI: {selectedClaim.rendering_provider_npi || "—"}</div>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-3 uppercase tracking-wider">Payer Setup</h3>
                  <div className={cn("p-3 rounded-lg border", selectedClaim.payer_id_value ? "bg-slate-50 border-slate-100" : "bg-red-50 border-red-100")}>
                    <div className="text-xs text-slate-500 mb-1">Target Payer</div>
                    <div className="text-sm font-medium text-slate-900">{selectedClaim.payer_name}</div>
                    <div className="text-sm font-mono text-slate-600 mt-1">ID: {selectedClaim.payer_id_value || "MISSING"}</div>
                  </div>
                </div>
              </div>
            )}

            {detailTab === 'dx' && (
              <div className="text-center p-8">
                <p className="text-sm text-slate-500">Diagnosis pointers preview for 837P loop 2400 SV107.</p>
                <div className="mt-4 flex justify-center">
                  {selectedClaim.diagnosis_codes.length > 0 ? (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 inline-flex gap-4">
                      {selectedClaim.diagnosis_codes.map((d, i) => (
                        <div key={d} className="flex flex-col items-center">
                          <span className="text-xs text-slate-400 font-mono mb-1">{i + 1}</span>
                          <Badge variant="outline" className="font-mono bg-white">{d}</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-red-500 text-sm font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      No diagnoses linked to claim
                    </div>
                  )}
                </div>
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

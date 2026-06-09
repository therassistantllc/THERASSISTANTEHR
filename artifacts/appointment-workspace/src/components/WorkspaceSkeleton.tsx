export function WorkspaceSkeleton() {
  return (
    <div className="w-full min-h-screen bg-[#f9fafc] flex flex-col animate-pulse">
      {/* Header skeleton */}
      <div className="flex justify-between items-start p-6 bg-white border-b border-slate-200 shrink-0">
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

      {/* Body skeleton */}
      <div className="p-6 flex-1 flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-6">
          {/* Left column */}
          <div className="flex flex-col gap-6">
            <div className="h-72 bg-slate-200 rounded-xl" />
            <div className="h-56 bg-slate-200 rounded-xl" />
            <div className="h-48 bg-slate-200 rounded-xl" />
          </div>
          {/* Right column */}
          <div className="flex flex-col gap-6">
            <div className="h-96 bg-slate-200 rounded-xl" />
          </div>
        </div>
        <div className="h-24 bg-slate-200 rounded-xl" />
        <div className="h-24 bg-slate-200 rounded-xl" />
      </div>
    </div>
  );
}

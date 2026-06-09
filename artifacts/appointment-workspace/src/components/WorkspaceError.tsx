import { AlertTriangle } from "lucide-react";

export function WorkspaceError({ message }: { message: string }) {
  return (
    <div className="w-full min-h-screen bg-[#f9fafc] flex items-center justify-center">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-md text-center">
        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-2">Unable to load workspace</h2>
        <p className="text-sm text-slate-600">{message}</p>
      </div>
    </div>
  );
}

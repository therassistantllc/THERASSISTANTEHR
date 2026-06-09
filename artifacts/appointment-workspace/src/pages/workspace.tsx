import { useWorkspaceData } from "@/hooks/useWorkspaceData";
import { CardGridDashboard } from "@/components/CardGridDashboard";
import { WorkspaceSkeleton } from "@/components/WorkspaceSkeleton";
import { WorkspaceError } from "@/components/WorkspaceError";

export default function WorkspacePage() {
  const state = useWorkspaceData();

  if (state.status === "loading") {
    return <WorkspaceSkeleton />;
  }

  if (state.status === "error") {
    return <WorkspaceError message={state.error} />;
  }

  if (state.status === "empty") {
    return (
      <div className="w-full min-h-screen bg-[#f9fafc] flex items-center justify-center">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 max-w-md text-center">
          <h2 className="text-lg font-bold text-slate-900 mb-2">No appointment selected</h2>
          <p className="text-sm text-slate-600">
            Add <code className="bg-slate-100 px-1 rounded">?appointmentId=xxx</code> to the URL to view a specific appointment.
          </p>
        </div>
      </div>
    );
  }

  return <CardGridDashboard data={state.data} />;
}

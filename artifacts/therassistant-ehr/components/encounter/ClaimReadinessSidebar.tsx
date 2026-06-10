export type ClaimReadinessCheck = {
  label: string;
  isComplete: boolean;
  required?: boolean;
};

type Props = {
  checks?: ClaimReadinessCheck[];
  encounterId?: string | null;
  claimId?: string | null;
  className?: string;
};

export default function ClaimReadinessSidebar({ checks = [], className = "" }: Props) {
  if (!checks.length) return null;

  const requiredChecks = checks.filter((check) => check.required);
  const completedRequired = requiredChecks.filter((check) => check.isComplete).length;
  const ready = requiredChecks.length > 0 && completedRequired === requiredChecks.length;

  return (
    <aside className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Claim readiness</h3>
          <p className="mt-1 text-xs text-slate-500">
            {ready
              ? "Required billing checks are complete."
              : `${completedRequired}/${requiredChecks.length} required checks complete.`}
          </p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
          ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
        }`}>
          {ready ? "Ready" : "Needs review"}
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start gap-2 text-xs text-slate-700">
            <span className={check.isComplete ? "text-emerald-600" : "text-amber-600"}>
              {check.isComplete ? "✓" : "•"}
            </span>
            <span>
              {check.label}
              {check.required ? <span className="ml-1 text-slate-400">(required)</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

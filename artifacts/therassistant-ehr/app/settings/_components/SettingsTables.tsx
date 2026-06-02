import Link from "next/link";

export type SettingsIndexRow = {
  settingArea: string;
  purpose: string;
  route: string;
  status: "Setup needed" | "Placeholder" | "Live";
};

export function SettingsIndexTable({ rows }: { rows: SettingsIndexRow[] }) {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
      <p className="mt-2 text-sm text-gray-600">
        Administrative configuration areas. Routes marked as placeholder are usable pages but still need implementation.
      </p>

      <div className="mt-6 overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-gray-50 text-left text-gray-700">
            <tr>
              <th className="border-b border-gray-200 px-4 py-3">Setting Area</th>
              <th className="border-b border-gray-200 px-4 py-3">Purpose</th>
              <th className="border-b border-gray-200 px-4 py-3">Route</th>
              <th className="border-b border-gray-200 px-4 py-3">Status</th>
              <th className="border-b border-gray-200 px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.route} className="align-top text-gray-900">
                <td className="border-b border-gray-100 px-4 py-3 font-medium">{row.settingArea}</td>
                <td className="border-b border-gray-100 px-4 py-3 text-gray-700">{row.purpose}</td>
                <td className="border-b border-gray-100 px-4 py-3 text-gray-700">{row.route}</td>
                <td className="border-b border-gray-100 px-4 py-3">
                  <span
                    className={
                      row.status === "Live"
                        ? "inline-flex rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                        : "inline-flex rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                    }
                  >
                    {row.status}
                  </span>
                </td>
                <td className="border-b border-gray-100 px-4 py-3">
                  <Link href={row.route} className="font-medium text-blue-700 hover:text-blue-800">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

export function SettingsPlaceholderTable({
  title,
  route,
  purpose,
  status = "Placeholder",
}: {
  title: string;
  route: string;
  purpose: string;
  status?: "Setup needed" | "Placeholder" | "Live";
}) {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
      <p className="mt-2 text-sm text-gray-600">{purpose}</p>

      <div className="mt-6 overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-gray-50 text-left text-gray-700">
            <tr>
              <th className="border-b border-gray-200 px-4 py-3">Item</th>
              <th className="border-b border-gray-200 px-4 py-3">Value</th>
              <th className="border-b border-gray-200 px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-b border-gray-100 px-4 py-3 font-medium">Route</td>
              <td className="border-b border-gray-100 px-4 py-3">{route}</td>
              <td className="border-b border-gray-100 px-4 py-3">Live</td>
            </tr>
            <tr>
              <td className="border-b border-gray-100 px-4 py-3 font-medium">Implementation</td>
              <td className="border-b border-gray-100 px-4 py-3">Table-based placeholder page</td>
              <td className="border-b border-gray-100 px-4 py-3">{status}</td>
            </tr>
            <tr>
              <td className="border-b border-gray-100 px-4 py-3 font-medium">Notes</td>
              <td className="border-b border-gray-100 px-4 py-3">No mock forms or database writes in this pass</td>
              <td className="border-b border-gray-100 px-4 py-3">Setup needed</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-sm">
        <Link href="/settings" className="font-medium text-blue-700 hover:text-blue-800">
          Back to Settings index
        </Link>
      </div>
    </main>
  );
}

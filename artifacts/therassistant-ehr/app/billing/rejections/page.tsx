import Link from "next/link";

const rows = [
  {
    label: "999 Rejections",
    purpose: "File and syntax level rejections from implementation acknowledgements.",
    route: "/billing/rejections-999",
  },
  {
    label: "277CA Rejections",
    purpose: "Claim-level acknowledgement rejections after clearinghouse edits.",
    route: "/billing/rejections-277ca",
  },
];

export default function BillingRejectionsLandingPage() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold text-gray-900">Rejections</h1>
      <p className="mt-2 text-sm text-gray-600">Choose a rejection queue to review and triage.</p>

      <div className="mt-6 overflow-x-auto rounded border border-gray-200 bg-white">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-gray-50 text-left text-gray-700">
            <tr>
              <th className="border-b border-gray-200 px-4 py-3">Queue</th>
              <th className="border-b border-gray-200 px-4 py-3">Purpose</th>
              <th className="border-b border-gray-200 px-4 py-3">Route</th>
              <th className="border-b border-gray-200 px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.route} className="align-top text-gray-900">
                <td className="border-b border-gray-100 px-4 py-3 font-medium">{row.label}</td>
                <td className="border-b border-gray-100 px-4 py-3 text-gray-700">{row.purpose}</td>
                <td className="border-b border-gray-100 px-4 py-3 text-gray-700">{row.route}</td>
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

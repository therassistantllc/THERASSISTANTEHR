import { redirect } from "next/navigation";

export const metadata = {
  title: "Ready to Generate",
};

export default function ReadyToGeneratePage({
  searchParams,
}: {
  searchParams?: { organizationId?: string };
}) {
  const params = new URLSearchParams();
  if (searchParams?.organizationId) params.set("organizationId", searchParams.organizationId);
  const query = params.toString();
  redirect(`/billing/charge-capture${query ? `?${query}` : ""}`);
}

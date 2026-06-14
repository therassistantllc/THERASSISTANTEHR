import MatchClientForEraClient from "./MatchClientForEraClient";

export const dynamic = "force-dynamic";

export default async function MatchClientForEraPage({
  params,
  searchParams,
}: {
  params: Promise<{ eraClaimPaymentId: string }>;
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const { eraClaimPaymentId } = await params;
  const { organizationId = "" } = await searchParams;

  return (
    <MatchClientForEraClient
      eraClaimPaymentId={eraClaimPaymentId}
      initialOrganizationId={organizationId}
    />
  );
}

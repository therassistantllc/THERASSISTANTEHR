import ClaimDetailClient from "./ClaimDetailClient";

export const metadata = {
  title: "Claim Detail",
};

export default async function ClaimDetailPage({
  params,
}: {
  params: Promise<{ claimId: string }>;
}) {
  const { claimId } = await params;
  return <ClaimDetailClient claimId={claimId} />;
}

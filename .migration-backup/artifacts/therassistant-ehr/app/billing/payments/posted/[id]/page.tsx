import PostedPaymentDetailClient from "./PostedPaymentDetailClient";

export const dynamic = "force-dynamic";

export default async function PostedPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PostedPaymentDetailClient compositeId={id} />;
}

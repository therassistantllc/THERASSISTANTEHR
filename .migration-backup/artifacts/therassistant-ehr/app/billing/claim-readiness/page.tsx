import { redirect } from "next/navigation";

export const metadata = {
  title: "No Response",
};

/**
 * Legacy route — the No Response queue now lives at /billing/no-response.
 * Kept as a redirect so old bookmarks / nav links continue to work.
 */
export default function ClaimReadinessLegacyPage() {
  redirect("/billing/no-response");
}

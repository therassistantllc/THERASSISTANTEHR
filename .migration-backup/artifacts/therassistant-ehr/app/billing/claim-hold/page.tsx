import { Metadata } from "next";
import ClaimHoldClient from "./ClaimHoldClient";

export const metadata: Metadata = {
  title: "Claim Hold · Billing",
};

export const dynamic = "force-dynamic";

export default function Page() {
  return <ClaimHoldClient />;
}

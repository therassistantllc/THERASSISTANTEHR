import { Metadata } from "next";
import DenialsByRarcClient from "./DenialsByRarcClient";

export const metadata: Metadata = {
  title: "Denied Claims by RARC · Billing",
};

export const dynamic = "force-dynamic";

export default function Page() {
  return <DenialsByRarcClient />;
}

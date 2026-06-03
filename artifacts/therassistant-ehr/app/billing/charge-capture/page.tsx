import { redirect } from "next/navigation";

export default function RetiredChargeCapturePage() {
  redirect("/billing/ready-to-generate");
}

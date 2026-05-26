import { redirect } from "next/navigation";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

export default async function HomePage() {
  // If Supabase is not configured yet, go straight to app
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) {
    redirect("/calendar");
  }
  redirect("/calendar");
}

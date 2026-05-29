"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase/client";

export default function LogoutPage() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await supabase.auth.signOut().catch(() => undefined);
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
      if (!cancelled) {
        window.location.replace("/login");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <p>Signing you out...</p>
    </main>
  );
}

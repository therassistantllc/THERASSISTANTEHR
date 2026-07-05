import Link from "next/link";
import { headers } from "next/headers";
import AppSidebarNav from "./AppSidebarNav";
import MobileNavButton from "./MobileNavButton";
import styles from "./AppShell.module.css";
import { TENANT_ID } from "@/lib/config";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

const CHROMELESS_PREFIXES = ["/portal"];

async function fetchTenantName(): Promise<string | null> {
  if (!TENANT_ID) return null;
  const supabase = createServerSupabaseAdminClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", TENANT_ID)
      .maybeSingle();

    if (error) return null;

    const name = (data as { name?: string | null } | null)?.name;
    return typeof name === "string" && name.trim().length > 0 ? name : null;
  } catch {
    return null;
  }
}

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "";
  if (CHROMELESS_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return <>{children}</>;
  }

  const tenantName = await fetchTenantName();
  const todayStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className={styles.frame}>
      <header className={styles.topbar}>
        <MobileNavButton />
        <span className={styles.currentDate}>{todayStr}</span>
        <span className={styles.orgName} title="Tenant">
          {tenantName ?? "+ Add tenant"}
        </span>
        <div className={styles.topbarSpacer} />
        <label className={styles.searchWrap} aria-label="Search THERASSISTANT EHR">
          <span className={styles.searchIcon} aria-hidden="true">Search</span>
          <input type="search" placeholder="Search" className={styles.searchBox} />
        </label>
        <button type="button" className={styles.notificationButton} aria-label="Notifications">
          <span aria-hidden="true">Alert</span>
        </button>
        <span className={styles.userAvatar} aria-label="User menu">TA</span>
      </header>

      <div className={styles.body}>
        <aside
          id="app-sidebar"
          data-app-sidebar
          className={styles.sidebar}
          aria-label="Application navigation"
        >
          <Link className={styles.brand} href="/">
            <span className={styles.brandName}>THERASSISTANT</span>
            <span className={styles.brandTag}>EHR</span>
          </Link>
          <AppSidebarNav />
        </aside>
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}

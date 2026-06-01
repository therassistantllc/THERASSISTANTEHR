import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function HomePage() {
  // Dev bypass: skip login when ALLOW_DEV_AUTH_BYPASS=true (local setup only)
  if (
    process.env.NODE_ENV === "development" &&
    process.env.ALLOW_DEV_AUTH_BYPASS === "true"
  ) {
    redirect("/settings");
  }

  const jar = await cookies();
  const hasSupabaseSessionCookie = jar
    .getAll()
    .some((cookie) => /sb-.*-auth-token/.test(cookie.name));

  if (hasSupabaseSessionCookie) {
    redirect("/calendar");
  }

  redirect("/login");
}

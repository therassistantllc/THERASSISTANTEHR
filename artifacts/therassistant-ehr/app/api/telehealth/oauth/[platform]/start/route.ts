import { NextResponse } from "next/server";
import { requireAuthenticatedStaff } from "@/lib/rbac/auth";
import {
  deriveAppOrigin,
  getPlatformConfig,
  getPlatformStatus,
  isTelehealthPlatform,
  redirectUriFor,
} from "@/lib/telehealth/config";
import { signOAuthState } from "@/lib/telehealth/oauthState";

export async function GET(
  request: Request,
  context: { params: Promise<{ platform: string }> },
) {
  const { platform } = await context.params;
  if (!isTelehealthPlatform(platform)) {
    return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }

  const status = getPlatformStatus(platform);
  if (!status.configured) {
    return NextResponse.json(
      {
        error: `${platform} OAuth is not configured`,
        missing: status.missingEnv,
        hint: `Add ${status.missingEnv.join(", ")} to project secrets and reload to enable Connect.`,
      },
      { status: 503 },
    );
  }

  const ctx = await requireAuthenticatedStaff();
  if (!ctx) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const cfg = getPlatformConfig(platform)!;
  const url = new URL(request.url);
  const providerId = url.searchParams.get("providerId");
  const origin = deriveAppOrigin(request);
  const redirectUri = redirectUriFor(platform, origin);

  let state: string;
  try {
    state = signOAuthState({ u: ctx.userId, o: ctx.organizationId, p: platform, pid: providerId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "OAuth state signing failed" },
      { status: 500 },
    );
  }

  const authUrl = new URL(cfg.authUrl);
  authUrl.searchParams.set("client_id", cfg.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  if (platform === "google_meet") {
    authUrl.searchParams.set("scope", cfg.scopes.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("include_granted_scopes", "true");
    if (ctx.email) authUrl.searchParams.set("login_hint", ctx.email);
  } else {
    authUrl.searchParams.set("scope", cfg.scopes.join(" "));
  }

  return NextResponse.redirect(authUrl.toString(), 302);
}

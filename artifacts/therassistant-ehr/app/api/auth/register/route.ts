import { NextResponse } from "next/server";
import { createServerSupabaseServiceRoleClient } from "@/lib/supabase/server";

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { email?: unknown; password?: unknown; fullName?: unknown }
      | null;

    if (!body) {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const email = asText(body.email).toLowerCase();
    const password = asText(body.password);
    const fullName = asText(body.fullName);

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ success: false, error: "A valid email is required" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ success: false, error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const supabase = createServerSupabaseServiceRoleClient();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: "Registration service is not configured" },
        { status: 503 },
      );
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName || null,
      },
    });

    if (!error && data.user) {
      return NextResponse.json({
        success: true,
        userId: data.user.id,
        email: data.user.email,
        created: true,
        message: "Account created. You can now sign in immediately.",
      });
    }

    const isAlreadyRegistered = /already\s+registered|already\s+been\s+registered/i.test(
      String(error?.message ?? ""),
    );

    if (!isAlreadyRegistered) {
      const msg = String(error?.message ?? "Failed to create account");
      return NextResponse.json({ success: false, error: msg }, { status: 400 });
    }

    // Recovery path: email already exists -> hard reset password + confirm email.
    let page = 1;
    let existingUserId: string | null = null;
    while (page <= 20 && !existingUserId) {
      const listed = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (listed.error) {
        return NextResponse.json(
          { success: false, error: listed.error.message || "Failed to look up existing account" },
          { status: 500 },
        );
      }

      const users = listed.data?.users ?? [];
      for (const user of users) {
        if (String(user.email ?? "").toLowerCase() === email) {
          existingUserId = user.id;
          break;
        }
      }

      if (users.length < 200) break;
      page += 1;
    }

    if (!existingUserId) {
      return NextResponse.json(
        { success: false, error: "Existing account was not found for reset" },
        { status: 404 },
      );
    }

    const updated = await supabase.auth.admin.updateUserById(existingUserId, {
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName || null,
      },
    });

    if (updated.error) {
      return NextResponse.json(
        { success: false, error: updated.error.message || "Failed to reset existing account" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      userId: existingUserId,
      email,
      created: false,
      message: "Existing account recovered. Password has been reset and can be used immediately.",
    });
  } catch (error) {
    console.error("auth register route failed", error);
    return NextResponse.json({ success: false, error: "Failed to register user" }, { status: 500 });
  }
}

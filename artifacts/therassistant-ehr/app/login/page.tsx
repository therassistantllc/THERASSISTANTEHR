"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

function normalizeAuthError(raw: string): string {
  const message = (raw || "").toLowerCase();
  if (message.includes("rate limit") || message.includes("too many")) {
    return "Too many attempts. Please wait and try again.";
  }
  if (message.includes("invalid login credentials")) {
    return "Invalid email or password.";
  }
  if (message.includes("already registered") || message.includes("already been registered")) {
    return "This email is already registered.";
  }
  if (message.includes("email not confirmed") || message.includes("email_not_confirmed")) {
    return "This account cannot sign in yet. Use hard reset below.";
  }
  return "Invalid email or password.";
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function completeServerLogin(nextPath: string): Promise<boolean> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token ?? null;

    // Retry once to handle eventual consistency between auth cookie write and server gate read.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await fetch(`/api/auth/login/complete?next=${encodeURIComponent(nextPath)}`, {
        method: "GET",
        cache: "no-store",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (!res.ok) continue;
      const json = (await res.json().catch(() => null)) as { success?: boolean; next?: string } | null;
      if (json?.success) {
        router.push(json.next || nextPath || "/calendar");
        return true;
      }
    }

    await supabase.auth.signOut();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setError("Unable to sign in to this workspace.");
    return false;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setLoading(false);
      setError(normalizeAuthError(error.message));
    } else {
      const next = searchParams.get("next") || "/calendar";
      const ok = await completeServerLogin(next);
      if (!ok) setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const registerRes = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        fullName,
      }),
    });
    const registerJson = (await registerRes.json().catch(() => null)) as
        | { success?: boolean; error?: string; created?: boolean; message?: string }
      | null;

    if (!registerRes.ok || !registerJson?.success) {
      setLoading(false);
      const normalized = normalizeAuthError(registerJson?.error || "Failed to create account");
      if (normalized.toLowerCase().includes("already registered")) {
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setMessage("Account already exists for this email. Please sign in or reset your password.");
      }
      setError(normalized);
      return;
    }

    const loginAfterRegister = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginAfterRegister.error) {
      setLoading(false);
      setError(normalizeAuthError(loginAfterRegister.error.message));
      return;
    }

    if (registerJson?.created === false) {
      setMessage("Existing account recovered. Your password has been reset.");
    }

    const next = searchParams.get("next") || "/calendar";
    const ok = await completeServerLogin(next);
    if (!ok) setLoading(false);
  }

  async function sendPasswordReset() {
    setError(null);
    setMessage(null);
    if (!email.trim()) {
      setError("Enter your email first, then click reset password.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: typeof window !== "undefined" ? `${window.location.origin}/login` : undefined,
    });
    setLoading(false);

    if (error) {
      setError(normalizeAuthError(error.message));
      return;
    }
    setMessage("Password reset email sent. Check your inbox.");
  }

  async function sendMagicLink() {
    setError(null);
    setMessage(null);
    if (!email.trim()) {
      setError("Enter your email first, then request a magic link.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
      },
    });
    setLoading(false);

    if (error) {
      setError(normalizeAuthError(error.message));
      return;
    }
    setMessage("Magic link sent. Open the email to sign in.");
  }

  async function hardResetAndLogin() {
    setError(null);
    setMessage(null);

    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    if (password.length < 8) {
      setError("Enter a new password with at least 8 characters, then click hard reset.");
      return;
    }

    setLoading(true);
    const registerRes = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, fullName }),
    });
    const registerJson = (await registerRes.json().catch(() => null)) as
      | { success?: boolean; error?: string; created?: boolean }
      | null;

    if (!registerRes.ok || !registerJson?.success) {
      setLoading(false);
      setError(normalizeAuthError(registerJson?.error || "Failed to reset account"));
      return;
    }

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      setLoading(false);
      setError(normalizeAuthError(loginError.message));
      return;
    }

    setMessage(
      registerJson.created === false
        ? "Account recovered and password reset. You are now signed in."
        : "Account created and signed in.",
    );
    const next = searchParams.get("next") || "/calendar";
    const ok = await completeServerLogin(next);
    if (!ok) setLoading(false);
  }

  function switchMode(next: "login" | "register") {
    setMode(next);
    setError(null);
    setMessage(null);
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--navy, #10243f)",
    }}>
      <div style={{
        background: "#fff",
        borderRadius: "12px",
        padding: "48px 40px",
        width: "100%",
        maxWidth: "400px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
      }}>
        <h1 style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: 700, color: "#10243f" }}>
          THERASSISTANT
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: "13px", color: "#6b7280" }}>
          EHR account access
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
          <button
            type="button"
            onClick={() => switchMode("login")}
            style={{
              padding: "9px 10px",
              borderRadius: 8,
              border: mode === "login" ? "1px solid #10243f" : "1px solid #d1d5db",
              background: mode === "login" ? "#10243f" : "#fff",
              color: mode === "login" ? "#fff" : "#10243f",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            style={{
              padding: "9px 10px",
              borderRadius: 8,
              border: mode === "register" ? "1px solid #10243f" : "1px solid #d1d5db",
              background: mode === "register" ? "#10243f" : "#fff",
              color: mode === "register" ? "#fff" : "#10243f",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Register
          </button>
        </div>

        <form onSubmit={mode === "login" ? handleLogin : handleRegister}>
          {mode === "register" && (
            <label style={{ display: "block", marginBottom: "16px" }}>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#374151", display: "block", marginBottom: "6px" }}>
                Full name
              </span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </label>
          )}

          <label style={{ display: "block", marginBottom: "16px" }}>
            <span style={{ fontSize: "13px", fontWeight: 500, color: "#374151", display: "block", marginBottom: "6px" }}>
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              style={{
                width: "100%",
                padding: "9px 12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: mode === "register" ? "16px" : "24px" }}>
            <span style={{ fontSize: "13px", fontWeight: 500, color: "#374151", display: "block", marginBottom: "6px" }}>
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "9px 12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </label>

          {mode === "register" && (
            <label style={{ display: "block", marginBottom: "24px" }}>
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#374151", display: "block", marginBottom: "6px" }}>
                Confirm password
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
            </label>
          )}

          {error && (
            <p style={{
              margin: "0 0 16px",
              padding: "10px 12px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "6px",
              fontSize: "13px",
              color: "#dc2626",
            }}>
              {error}
            </p>
          )}

          {message && (
            <p style={{
              margin: "0 0 16px",
              padding: "10px 12px",
              background: "#ecfeff",
              border: "1px solid #a5f3fc",
              borderRadius: "6px",
              fontSize: "13px",
              color: "#155e75",
            }}>
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "10px",
              background: loading ? "#6b7280" : "#10243f",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading
              ? mode === "login" ? "Signing in..." : "Creating account..."
              : mode === "login" ? "Sign in" : "Create account"}
          </button>

          {mode === "login" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
              <button
                type="button"
                onClick={() => void sendPasswordReset()}
                disabled={loading}
                style={{
                  padding: "9px 10px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  color: "#10243f",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                Reset password
              </button>
              <button
                type="button"
                onClick={() => void sendMagicLink()}
                disabled={loading}
                style={{
                  padding: "9px 10px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  color: "#10243f",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                Send magic link
              </button>
              <button
                type="button"
                onClick={() => void hardResetAndLogin()}
                disabled={loading}
                style={{
                  gridColumn: "1 / span 2",
                  padding: "9px 10px",
                  borderRadius: 6,
                  border: "1px solid #10243f",
                  background: "#f8fafc",
                  color: "#10243f",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                Hard reset account (no email link)
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
